'use strict';

import {
   MUTABLE_DATUM_DIR_TYPE,
   MUTABLE_DATUM_FILE_TYPE,
   DATASTORE_SCHEMA,
   DATASTORE_RESPONSE_SCHEMA,
   MUTABLE_DATUM_INODE_SCHEMA,
   MUTABLE_DATUM_DIR_IDATA_SCHEMA,
   MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA,
   SUCCESS_FAIL_SCHEMA,
   DATASTORE_LOOKUP_RESPONSE_SCHEMA,
   DATASTORE_LOOKUP_EXTENDED_RESPONSE_SCHEMA,
   CORE_ERROR_SCHEMA,
} from './schemas';

import {
   makeFileInodeBlob,
   makeDirInodeBlob,
   makeMutableDataInfo,
   signDataPayload,
   signRawData,
   hashDataPayload,
   hashRawData,
   inodeDirLink,
   inodeDirUnlink,
   decodePrivateKey,
   makeInodeTombstones,
   makeMutableDataTombstones,
   signMutableDataTombstones,
   getChildVersion,
} from './inode';

import {
   jsonStableSerialize
} from './util';


const http = require('http');
const uuid4 = require('uuid/v4');
const bitcoinjs = require('bitcoinjs-lib');
const BigInteger = require('bigi');
const Promise = require('promise');
const assert = require('assert');
const Ajv = require('ajv');
const jsontokens = require('jsontokens');

const EPERM = 1;
const ENOENT = 2;
const EACCES = 13;
const EEXIST = 17;
const ENOTDIR = 20;
const EINVAL = 22;
const EREMOTEIO = 121;

const LOCAL_STORAGE_ID = "blockstack";
const SUPPORTED_STORAGE_CLASSES = ["read_public", "write_public", "read_private", "write_private", "read_local", "write_local"];
const REPLICATION_STRATEGY_CLASSES = {
   'local': new Set(['read_local', 'write_local']),
   'publish': new Set(['read_public', 'write_private']),
   'public': new Set(['read_public', 'write_public']),
   'private': new Set(['read_private', 'write_private']),
};

/*
 * Helper method to validate a JSON response
 * against a schema.  Returns the validated object
 * on success, and throw an exception on error.
 */
function validateJSONResponse(resp, result_schema) {

   const ajv = new Ajv();
   if (result_schema) {
      try {
         const valid = ajv.validate(result_schema, resp);
         assert(valid);
         return resp;
      }
      catch(e) {
         try {
            // error message
            const valid = ajv.validate(CORE_ERROR_SCHEMA, resp);
            assert(valid);
            return resp;
         }
         catch(e2) {
            console.log("Failed to validate with desired schema");
            console.log(e.stack);
            console.log("Failed to validate with error schema");
            console.log(e2.stack);
            console.log("Desired schema:");
            console.log(result_schema);
            console.log("Parsed message:");
            console.log(resp);
            throw new Error("Invalid core message");
         }
      }
   }
   else {
      return resp;
   }
}


/*
 * Helper method to issue an HTTP request.
 * @param options (Object) set of HTTP request options
 * @param result_schema (Object) JSON schema of the expected result
 *
 * Returns a structured JSON response on success, conformant to the result_schema.
 * Returns plaintext on success if the content-type is application/octet-stream
 * Returns a structured {'error': ...} object on client-side error
 * Throws on server-side error
 */
function httpRequest(options, result_schema, body) {

    if (body) {
       options['body'] = body;
    }

    const url = `http://${options.host}:${options.port}${options.path}`;
    return fetch(url, options)
    .then((response) => {

        if(response.status >= 500) {
           throw new Error(response.statusText);
        }

        if(response.status === 404) {
           return {'error': 'No such file or directory', 'errno': ENOENT};
        }

        if(response.status === 403) {
           return {'error': 'Access denied', 'errno': EACCES};
        }

        if(response.status === 401) {
           return {'error': 'Invalid request', 'errno': EINVAL};
        }

        if(response.status === 400) {
           return {'error': 'Operation not permitted', 'errno': EPERM};
        }

        let resp = null;
        if (response.headers.get('content-type') === 'application/json') {
           return response.json()
           .then((resp) => {
              return validateJSONResponse(resp, result_schema);
           });
        }
        else {
           return response.text();
        }
    });
}


/*
 * Convert a datastore public key to its ID.
 * @param ds_public_key (String) hex-encoded ECDSA public key
 */
export function datastoreGetId( ds_public_key_hex) {
    let ec = bitcoinjs.ECPair.fromPublicKeyBuffer( Buffer.from(ds_public_key_hex, 'hex') );
    return ec.getAddress();
}


/*
 * Get a *uncompressed* public key (hex) from private key
 */
function getPubkeyHex(privkey_hex) {
   let privkey = BigInteger.fromBuffer( decodePrivateKey(privkey_hex) );
   let public_key = new bitcoinjs.ECPair(privkey);

   public_key.compressed = false;
   let public_key_str = public_key.getPublicKeyBuffer().toString('hex');
   return public_key_str;
}


/*
 * Get query string device list from datastore context
 */
function getDeviceList(datastore_ctx) {
   const escaped_device_ids = [];
   for (let dk of datastore_ctx.app_public_keys) {
      escaped_device_ids.push(escape(dk.device_id));
   }
   const res = escaped_device_ids.join(',');
   return res;
}


/*
 * Get query string public key list from datastore context
 */
function getPublicKeyList(datastore_ctx) {
   const escaped_public_keys = [];
   for (let dk of datastore_ctx.app_public_keys) {
      escaped_public_keys.push(escape(dk.public_key));
   }
   const res = escaped_public_keys.join(',');
   return res;
}

/*
 * Sanitize a path.  Consolidate // to /, and resolve foo/../bar to bar
 * @param path (String) the path
 *
 * Returns the sanitized path.
 */
export function sanitizePath( path) {

    const parts = path.split('/').filter(function(x) {return x.length > 0;});
    const retparts = [];

    for(let i = 0; i < parts.length; i++) {
       if (parts[i] === '..') {
          retparts.pop();
       }
       else {
          retparts.push(parts[i]);
       }
    }

    return '/' + retparts.join('/');
}


/*
 * Given a path, get the parent directory.
 *
 * @param path (String) the path.  Must be sanitized
 */
export function dirname(path) {
    return '/' + path.split('/').slice(0, -1).join('/');
}


/*
 * Given a path, get the base name
 *
 * @param path (String) the path. Must be sanitized
 */
export function basename(path) {
   return path.split('/').slice(-1)[0];
}


/*
 * Given a host:port string, split it into
 * a host and port
 *
 * @param hostport (String) the host:port
 *
 * Returns an object with:
 *      .host
 *      .port
 */
function splitHostPort(hostport) {

   let host = hostport;
   let port = 80;
   const parts = hostport.split(':');
   if (parts.length > 1) {
      host = parts[0];
      port = parts[1];
   }

   return {'host': host, 'port': port};
}


/*
 * Create the signed request to create a datastore.
 * This information can be fed into datastoreCreate()
 * Returns an object with:
 *      .datastore_info: datastore information
 *      .datastore_sigs: signatures over the above.
 */
export function datastoreCreateRequest( ds_type, ds_private_key_hex, drivers, device_id, all_device_ids) {

   assert(ds_type === 'datastore' || ds_type === 'collection');
   const root_uuid = uuid4();

   const ds_public_key = getPubkeyHex(ds_private_key_hex);
   const datastore_id = datastoreGetId( ds_public_key );
   const root_blob_info = makeDirInodeBlob( datastore_id, datastore_id, root_uuid, {}, device_id, 1 );

   // actual datastore payload
   const datastore_info = {
      'type': ds_type,
      'pubkey': ds_public_key,
      'drivers': drivers,
      'device_ids': all_device_ids,
      'root_uuid': root_uuid,
   };

   const data_id = `${datastore_id}.datastore`;
   const datastore_blob = makeMutableDataInfo( data_id, jsonStableSerialize(datastore_info), device_id, 1 );

   const datastore_str = jsonStableSerialize(datastore_blob);

   // sign them all
   const root_sig = signDataPayload( root_blob_info.header, ds_private_key_hex );
   const datastore_sig = signDataPayload( datastore_str, ds_private_key_hex );

   // make and sign tombstones for the root
   const root_tombstones = makeInodeTombstones(datastore_id, root_uuid, all_device_ids);
   const signed_tombstones = signMutableDataTombstones(root_tombstones, ds_private_key_hex);

   const info = {
      'datastore_info': {
         'datastore_id': datastore_id,
         'datastore_blob': datastore_str,
         'root_blob_header': root_blob_info.header,
         'root_blob_idata': root_blob_info.idata,
      },
      'datastore_sigs': {
         'datastore_sig': datastore_sig,
         'root_sig': root_sig,
      },
      'root_tombstones': signed_tombstones,
   };

   return info;
}


/*
 * Create a datastore
 * Asynchronous; returns a Promise that resolves to either {'status': true} (on success)
 * or {'error': ...} (on error)
 */
export function datastoreCreate( blockstack_hostport, blockstack_session_token, datastore_request) {

   const payload = {
      'datastore_info': {
          'datastore_blob': datastore_request.datastore_info.datastore_blob,
          'root_blob_header': datastore_request.datastore_info.root_blob_header,
          'root_blob_idata': datastore_request.datastore_info.root_blob_idata,
      },
      'datastore_sigs': {
          'datastore_sig': datastore_request.datastore_sigs.datastore_sig,
          'root_sig': datastore_request.datastore_sigs.root_sig,
      },
      'root_tombstones': datastore_request.root_tombstones,
   };

   const hostinfo = splitHostPort(blockstack_hostport);

   const options = {
      'method': 'POST',
      'host': hostinfo.host,
      'port': hostinfo.port,
      'path': '/v1/stores'
   };

   options['headers'] = {'Authorization': `bearer ${blockstack_session_token}`};

   const body = JSON.stringify(payload);
   options['headers']['Content-Type'] = 'application/json';
   options['headers']['Content-Length'] = body.length;

   return httpRequest(options, SUCCESS_FAIL_SCHEMA, body);
}


/*
 * Generate the data needed to delete a datastore.
 *
 * @param ds (Object) a datastore context (will be loaded from localstorage if not given)
 *
 * Returns an object to be given to datastoreDelete()
 */
export function datastoreDeleteRequest(ds=null) {

   if (!ds) {
      const blockchain_id = getSessionBlockchainID();
      assert(blockchain_id);

      ds = getCachedMountContext(blockchain_id);
      assert(ds);
   }

   const datastore_id = ds.datastore_id;
   const device_ids = ds.datastore.device_ids;
   const root_uuid = ds.datastore.root_uuid;
   const data_id = `${datastore_id}.datastore`;

   const tombstones = makeMutableDataTombstones( device_ids, data_id );
   const signed_tombstones = signMutableDataTombstones( tombstones, ds.privkey_hex );

   const root_tombstones = makeInodeTombstones(datastore_id, root_uuid, device_ids);
   const signed_root_tombstones = signMutableDataTombstones( root_tombstones, ds.privkey_hex );

   const ret = {
      'datastore_tombstones': signed_tombstones,
      'root_tombstones': signed_root_tombstones,
   };

   return ret;
}

/*
 * Delete a datastore
 *
 * @param ds (Object) OPTINOAL: the datastore context (will be loaded from localStorage if not given)
 * @param ds_tombstones (Object) OPTINOAL: signed information from datastoreDeleteRequest()
 * @param root_tombstones (Object) OPTINAL: signed information from datastoreDeleteRequest()
 *
 * Asynchronous; returns a Promise that resolves to either {'status': true} on success
 * or {'error': ...} on error
 */
export function datastoreDelete(ds=null, ds_tombstones=null, root_tombstones=null) {

   if (!ds) {
      const blockchain_id = getSessionBlockchainID();
      assert(blockchain_id);

      ds = getCachedMountContext(blockchain_id);
      assert(ds);
   }

   if (!ds_tombstones || !root_tombstones) {
      const delete_info = datastoreDeleteRequest(ds);
      ds_tombstones = delete_info['datastore_tombstones'];
      root_tombstones = delete_info['root_tombstones'];
   }

   const device_list = getDeviceList(ds);
   const payload = {
      'datastore_tombstones': ds_tombstones,
      'root_tombstones': root_tombstones,
   };

   const options = {
      'method': 'DELETE',
      'host': ds.host,
      'port': ds.port,
      'path': `/v1/stores?device_ids=${device_list}`
   };

   options['headers'] = {'Authorization': `bearer ${getSessionToken()}`}

   const body = JSON.stringify(payload);
   options['headers']['Content-Type'] = 'application/json';
   options['headers']['Content-Length'] = body.length;

   return httpRequest(options, SUCCESS_FAIL_SCHEMA, body);
}


/*
 * Look up a datastore and establish enough contextual information to do subsequent storage operations.
 * Asynchronous; returns a Promise
 *
 * opts is an object that must contain either:
 * * appPrivateKey (string) the application private key
 * * (optional) sessionToken (string) the Core session token, OR
 * * (optional) device_id (string) the device ID
 *
 * OR:
 *
 * * blockchainID (string) the blockchain ID of the user whose datastore we're going to access
 * * appName (string) the name of the application
 *
 * TODO: support accessing datastores from other users
 *
 * Returns a Promise that resolves to a datastore connection,
 * with the following properties:
 *      .host: blockstack host
 *      .datastore: datastore object
 *
 * Returns a Promise that resolves to null, if the datastore does not exist.
 *
 * Throws an error on all other errors
 */
export function datastoreMount(opts) {

   let data_privkey_hex = opts.appPrivateKey;
   const no_cache = opts.noCachedMounts;

   let sessionToken = opts.sessionToken;
   let blockchain_id = opts.blockchainID;
   let session_blockchain_id = getSessionBlockchainID(sessionToken);
   let datastore_id = null;
   let device_id = null;
   let api_endpoint = null;
   let app_public_keys = null;

   // maybe cached?
   if (blockchain_id && !no_cache) {
       let ds = getCachedMountContext(blockchain_id);
       if (ds) {
          return new Promise((resolve, reject) => { resolve(ds); });
       }
   }
   
   if (!blockchain_id || blockchain_id === session_blockchain_id) {

       // assume the one in this session
       if (!sessionToken) {
          // load from localStorage
          const userData = getUserData();

          sessionToken = userData.coreSessionToken;
          assert(sessionToken);
       }

       if (!blockchain_id){
          blockchain_id = getSessionBlockchainID(sessionToken);
       }

       assert(blockchain_id);

       const session = jsontokens.decodeToken(sessionToken).payload;

       device_id = session.device_id;
       api_endpoint = session.api_endpoint;
       app_public_keys = session.app_public_keys;
       datastore_id = datastoreGetId(getPubkeyHex(data_privkey_hex));
       blockchain_id = session_blockchain_id;
   } 
   else {
      // TODO: look up the datastore information via Core
      // TODO: blocked by Core's lack of support for token files
      // TODO: set device_id, blockchain_id, app_public_keys
      throw new Error("Multiplayer storage is not supported yet");
   }

   if (!device_id) {
      device_id = session.device_id;
      assert(device_id);
   }

   if (!api_endpoint) {
      api_endpoint = session.api_endpoint;
      assert(api_endpoint);
   }

   if (!blockchain_id) {
      blockchain_id = getBlockchainIDFromSessionOrDefault(session);
   }

   if (!app_public_keys) {
      app_public_keys = session.app_public_keys;
      assert(app_public_keys);
   }

   const blockstack_hostport = api_endpoint.split('://').reverse()[0];
   const hostinfo = splitHostPort(blockstack_hostport);

   const ctx = {
      'host': hostinfo.host,
      'port': hostinfo.port,
      'blockchain_id': blockchain_id,
      'device_id': device_id,
      'datastore_id': datastore_id,
      'app_public_keys': app_public_keys,
      'datastore': null,
   };

   if (data_privkey_hex) {
      ctx.privkey_hex = data_privkey_hex;
   }

   const options = {
      'method': 'GET',
      'host': hostinfo.host,
      'port': hostinfo.port,
      'path': `/v1/stores/${datastore_id}?device_ids=${device_id}&blockchain_id=${blockchain_id}`,
   }

   console.log(`Mount datastore ${options.path}`);
   options['headers'] = {'Authorization': `bearer ${sessionToken}`};

   return httpRequest(options, DATASTORE_RESPONSE_SCHEMA).then((ds) => {
      if (!ds || ds.error) {
         // ENOENT?
         if (!ds || ds.errno === ENOENT) {
             return null;
         }
         else {
             let errorMsg = ds.error || 'No response given';
             throw new Error(`Failed to get datastore: ${errorMsg}`);
         }
      }
      else {
         ctx['datastore'] = ds.datastore;

         // this is required for testing purposes, since the core session token will not have been set
         let userData = getUserData();
         if (!userData.coreSessionToken) {
            console.log("In test framework; saving session token");
            userData.coreSessionToken = sessionToken;
            setUserData(userData);
         }

         // save
         setCachedMountContext(blockchain_id, ctx);

         return ctx;
      }
   });
}


/*
 * Get a reference to our localStorage implementation
 */
function getLocalStorage() {
   // uncomment when testing locally.  Make sure node-localstorage is installed!
   /*
   let localStorage = null;
    
   if (typeof window === 'undefined' || window === null) {
      const LocalStorage = require('node-localstorage').LocalStorage;
      localStorage = new LocalStorage('./scratch');
   }
   else {
      localStorage = window.localStorage;
   }
   */
   return localStorage;
}


/*
 * Get local storage object for Blockstack
 * Throws on error
 */
function getUserData() {

   const localStorage = getLocalStorage();
   let userData = localStorage.getItem(LOCAL_STORAGE_ID);
   if (userData === null || typeof(userData) === 'undefined') {
      userData = '{}';
   }

   userData = JSON.parse(userData);
   return userData;
}


/*
 * Save local storage
 */
function setUserData(userData) {

   const localStorage = getLocalStorage();
   localStorage.setItem(LOCAL_STORAGE_ID, JSON.stringify(userData));
}


/*
 * Get a cached app-specific datastore mount context for a given blockchain ID and application
 * Return null if not found
 * Throws on error
 */
function getCachedMountContext(blockchain_id) {

   let userData = getUserData();
   assert(userData);

   if (!userData.datastore_contexts) {
      console.log("No datastore contexts defined");
      return null;
   }

   if (!userData.datastore_contexts[blockchain_id]) {
      console.log(`No datastore contexts for ${blockchain_id}`);
      return null;
   }

   let ctx = userData.datastore_contexts[blockchain_id];
   if (!ctx) {
      console.log(`Null datastore context for ${blockchain_id}`);
      return null;
   }

   return ctx;
}


/*
 * Cache a mount context for a blockchain ID
 */
function setCachedMountContext(blockchain_id, datastore_context) {

   let userData = getUserData();
   assert(userData);

   if (!userData.datastore_contexts) {
      userData.datastore_contexts = {};
   }

   userData.datastore_contexts[blockchain_id] = datastore_context;
   setUserData(userData);
}

function getBlockchainIDFromSessionOrDefault(session) {
   if (! session.blockchain_id ){
       return hashRawData(Buffer.from(session.app_user_id).toString('base64'));
   }else{
       return session.blockchain_id;
   }
}


/*
 * Get the session token from localstorage
 */
function getSessionToken() {
    let userData = getUserData();
    assert(userData);
    assert(userData.coreSessionToken);

    let sessionToken = userData.coreSessionToken;
    return sessionToken;
}


/*
 * Get the current session's blockchain ID
 * Throw if not defined or not present.
 */
function getSessionBlockchainID(sessionToken=null) {

   if (!sessionToken) {
      sessionToken = getSessionToken();
   }

   const session = jsontokens.decodeToken(sessionToken).payload;

   return getBlockchainIDFromSessionOrDefault(session);
}


/*
 * Fulfill a replication strategy using the drivers available to us.
 *
 * replication_strategy (object): a dict that maps strategies (i.e. 'local', 'public', 'private') to integer counts
 * classes (object): this is session.storage.classes (i.e. the driver classification; maps a driver name to its list of classes)
 *
 * Returns the list of drivers to use.
 * Throws on error.
 */
function selectDrivers(replication_strategy, classes) {

   // select defaults from classification and replication strategy
   let driver_sets = [];            // driver_sets[i] is the set of drivers that support SUPPORTED_STORAGE_CLASSES[i]
   let driver_classes = {};         // map driver name to set of classes
   let all_drivers = new Set([]);   // set of all drivers available to us
   let available_drivers = [];      // drivers available to us
   let selected_drivers = [];       // drivers compatible with our replication strategy (return value)
   let have_drivers = false;        // whether or not we selected drivers that fulfill our replication strategy

   for (let i = 0; i < SUPPORTED_STORAGE_CLASSES.length; i++) {
      let driver_set = new Set(classes[SUPPORTED_STORAGE_CLASSES[i]]);
      driver_sets.push(driver_set);

      for(let d of driver_set) {
          all_drivers.add(d);
      }

      for( let d of driver_set ) {
         console.log(`Driver ${d} implementes ${SUPPORTED_STORAGE_CLASSES[i]}`);
         if (driver_classes[d]) {
            driver_classes[d].push(SUPPORTED_STORAGE_CLASSES[i]);
         }
         else {
            driver_classes[d] = [SUPPORTED_STORAGE_CLASSES[i]];
         }
      }
   }

   let concern_fulfillment = {};

   for (let d of all_drivers) {
      let classes = driver_classes[d];

      // a driver fits the replication strategy if all of its
      // classes matches at least one concern (i.e. 'local', 'public')
      for (let concern of Object.keys(replication_strategy)) {

          let matches = false;
          for (let dclass of classes) {
             if (REPLICATION_STRATEGY_CLASSES[concern].has(dclass)) {
                matches = true;
                break;
             }
          }

          if (matches) {
             console.log(`Driver ${d} fulfills replication concern ${concern}`);

             if (concern_fulfillment[concern]) {
                concern_fulfillment[concern] += 1;
             }
             else {
                concern_fulfillment[concern] = 1;
             }

             if (concern_fulfillment[concern] <= replication_strategy[concern]) {
                console.log(`Select driver ${d}`);
                selected_drivers.push(d);
             }
          }

          // strategy fulfilled?
          let fulfilled = true;
          for (let concern of Object.keys(replication_strategy)) {
             let count = 0;
             if (concern_fulfillment[concern]) {
                count = concern_fulfillment[concern];
             }

             if (count < replication_strategy[concern]) {
                fulfilled = false;
                break;
             }
          }

          if (fulfilled) {
             have_drivers = true;
             break;
          }
      }

      if (have_drivers) {
         break;
      }
   }

   if (!have_drivers) {
      throw new Error("Unsatisfiable replication strategy");
   }

   return selected_drivers;
}



/*
 * Connect to or create a datastore.
 * Asynchronous, returns a Promise
 *
 * Returns a Promise that yields a datastore connection.
 * Throws on error.
 *
 */
export function datastoreMountOrCreate(replication_strategy={'public': 1, 'local': 1}, sessionToken=null, appPrivateKey=null) {

   if(!sessionToken) {
      const userData = getUserData();

      sessionToken = userData.coreSessionToken;
      assert(sessionToken);
   }

   // decode
   const session = jsontokens.decodeToken(sessionToken).payload;
   var blockchain_id = getBlockchainIDFromSessionOrDefault(session);

   let ds = getCachedMountContext(blockchain_id);
   if (ds) {
      return new Promise((resolve, reject) => { resolve(ds); });
   }

   // no cached datastore context.
   // go ahead and create one (need appPrivateKey)
   if(!appPrivateKey) {
      const userData = getUserData();

      appPrivateKey = userData.appPrivateKey;
      assert(appPrivateKey);
   }

   // sanity check
   for (let strategy of Object.keys(replication_strategy)) {
      let supported = false;
      for (let supported_strategy of Object.keys(REPLICATION_STRATEGY_CLASSES)) {
         if (supported_strategy === strategy) {
            supported = true;
            break;
         }
      }

      if (!supported) {
         throw new Error(`Unsupported replication strategy ${strategy}`);
      }
   }

   let drivers = null;

   // find satisfactory storage drivers
   if (Object.keys(session.storage.preferences).includes(session.app_domain)) {

      // app-specific preference
      drivers = session.storage.preferences[app_domain];
   }
   else {

      // select defaults given the replication strategy
      drivers = selectDrivers(replication_strategy, session.storage.classes);
   }

   const hostport = session.api_endpoint.split('://').reverse()[0];
   const appPublicKeys = session.app_public_keys;
   const deviceID = session.device_id;
   const allDeviceIDs = [];

   for (let i = 0; i < appPublicKeys.length; i++) {
      allDeviceIDs.push(appPublicKeys[i].device_id);
   }

   console.log(`Will use drivers ${drivers.join(',')}`);
   console.log(`Datastore will span devices ${allDeviceIDs.join(',')}`);

   const datastoreOpts = {
      'appPrivateKey': appPrivateKey,
      'sessionToken': sessionToken,
   };

   return datastoreMount(datastoreOpts)
   .then((datastore_ctx) => {
      if (!datastore_ctx) {
         // does not exist
         console.log("Datastore does not exist; creating...");

         const info = datastoreCreateRequest('datastore', appPrivateKey, drivers, deviceID, allDeviceIDs );

         // go create it
         return datastoreCreate( hostport, sessionToken, info )
         .then((res) => {
            if (res.error) {
               console.log(error);
               let errorNo = res.errno || 'UNKNOWN';
               let errorMsg = res.error || 'UNKNOWN';
               throw new Error(`Failed to create datastore (errno ${errorNo}): ${errorMsg}`);
            }

            // connect to it now
            return datastoreMount(datastoreOpts);
         });
      }
      else if (datastore_ctx.error) {
         // some other error
         let errorMsg = datastore_ctx.error || 'UNKNOWN';
         let errorNo = datastore_ctx.errno || 'UNKNOWN';
         throw new Error(`Failed to access datastore (errno ${errorNo}): ${errorMsg}`);
      }
      else {
         // exists
         return datastore_ctx;
      }
   });
}


/*
 * Path lookup
 *
 * @param path (String) the path to the inode
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode information
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .idata (Bool) if True, then get the inode payload as well
 *      .blockchain_id (String) this is the blockchain ID of the datastore owner, if different from the session token
 *      .ds (datastore context) if given, then use this datastore mount context instead of one from localstorage
 *
 * Returns a promise that resolves to a lookup response schema (or an extended lookup response schema, if opts.extended is set)
 */
export function lookup(path, opts={}) {

   let blockchain_id = opts.blockchainID;

   if (!blockchain_id) {
      blockchain_id = getSessionBlockchainID();
   }

   return datastoreMount({'blockchainID': blockchain_id})
   .then((ds) => {
      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_list = getDeviceList(ds);
      const device_pubkeys = getPublicKeyList(ds);
      const options = {
         'method': 'GET',
         'host': ds.host,
         'port': ds.port,
         'path': `/v1/stores/${datastore_id}/inodes?path=${escape(sanitizePath(path))}&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${blockchain_id}`,
      };

      if (!opts) {
         opts = {};
      }

      let schema = DATASTORE_LOOKUP_RESPONSE_SCHEMA;

      if (opts.extended) {
         options['path'] += '&extended=1';
         schema = DATASTORE_LOOKUP_EXTENDED_RESPONSE_SCHEMA;
      }

      if (opts.force) {
         options['path'] += '&force=1';
      }

      if (opts.idata) {
         options['idata'] += '&idata=1';
      }

      return httpRequest(options, schema)
      .then((lookup_response) => {
         if (lookup_response.error || lookup_response.errno) {
            let errorMsg = lookup_response.error || 'UNKNOWN';
            let errorNo = lookup_response.errno || 'UNKNOWN';
            throw new Error(`Failed to look up ${path} (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return lookup_response;
         }
      });
   });
}


/*
 * List a directory.
 *
 * @param path (String) the path to the directory to list
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise that resolves to either directory idata, or an extended mutable datum response (if opts.extended is set)
 */
export function listdir(path, opts={}) {

   let blockchain_id = opts.blockchainID;

   if (!blockchain_id) {
      blockchain_id = getSessionBlockchainID();
   }

   return datastoreMount({'blockchainID': blockchain_id})
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_list = getDeviceList(ds);
      const device_pubkeys = getPublicKeyList(ds);
      const options = {
         'method': 'GET',
         'host': ds.host,
         'port': ds.port,
         'path': `/v1/stores/${datastore_id}/directories?path=${escape(sanitizePath(path))}&idata=1&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${blockchain_id}`,
      };

      let schema = MUTABLE_DATUM_DIR_IDATA_SCHEMA;

      if (!opts) {
         opts = {};
      }

      if (opts.extended) {
         options['path'] += '&extended=1';
         schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
      }

      if (opts.force) {
         optsion['path'] += '&force=1';
      }

      return httpRequest(options, schema)
      .then((response) => {
         if (response.error || response.errno) {
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to listdir ${path} (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return response;
         }
      });
   });
}


/*
 * Stat a file or directory (i.e. get the inode header)
 *
 * @param path (String) the path to the directory to list
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise that resolves to either an inode schema, or a mutable datum extended response schema (if opts.extended is set)
 */
export function stat(path, opts={}) {

   let ds = opts.ds;
   let blockchain_id = opts.blockchainID;

   if (!blockchain_id) {
      blockchain_id = getSessionBlockchainID();
   }

   return datastoreMount({'blockchainID': blockchain_id})
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_list = getDeviceList(ds);
      const device_pubkeys = getPublicKeyList(ds);
      const options = {
         'method': 'GET',
         'host': ds.host,
         'port': ds.port,
         'path': `/v1/stores/${datastore_id}/inodes?path=${escape(sanitizePath(path))}&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${blockchain_id}`,
      };

      let schema = MUTABLE_DATUM_INODE_SCHEMA;

      if (!opts) {
         opts = {};
      }

      if (opts.extended) {
         options['path'] += '&extended=1';
         schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
      }

      if (opts.force) {
         optsion['path'] += '&force=1';
      }

      return httpRequest(options, schema)
      .then((response) => {
         if (response.error || response.errno) {
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to stat ${path} (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return response;
         }
      });
   });
}


/*
 * Get an undifferentiated file or directory and its data.
 * Low-level method, not meant for external consumption.
 *
 * @param path (String) the path to the directory to list
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise that resolves to an inode and its data, or an extended mutable datum response (if opts.extended is set)
 */
function getInode(path, opts={}) {

   let blockchain_id = opts.blockchainID;

   if (!blockchain_id) {
      blockchain_id = getSessionBlockchainID();
   }

   return datastoreMount({'blockchainID': blockchain_id})
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_list = getDeviceList(ds);
      const device_pubkeys = getPublicKeyList(ds);
      const options = {
         'method': 'GET',
         'host': ds.host,
         'port': ds.port,
         'path': `/v1/stores/${datastore_id}/inodes?path=${escape(sanitizePath(path))}&idata=1&extended=1&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${blockchain_id}`,
      };

      let schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;

      if (!opts) {
         opts = {};
      }

      if (opts.extended) {
         options['path'] += '&extended=1';
         schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
      }

      if (opts.force) {
         options['path'] += '&force=1';
      }

      return httpRequest(options, schema)
      .then((response) => {
         if (response.error || response.errno) {
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to getInode ${path} (errno: ${errorNo}): ${errorMsg}`);
         }
         else {

            // act on hints
            // * if this is a directory, and there are "absent children"
            // (i.e. children that we tried but only partially succeeded to create),
            // then erase them.
            let inode = response.inode_info.inode;
            if (inode.type === MUTABLE_DATUM_DIR_TYPE && response.hints && response.hints.children_absent) {
               for (let child_name of response.hints.children_absent) {
                  if (Object.keys(inode.idata.children).includes(child_name)) {
                     // mask this 
                     console.log(`child inode ${child_name} is only partially-created; masking...`);
                     delete response.inode_info.inode.idata.children[child_name];
                  }
               }
            }

            return response;
         }
      });
   });
}


/*
 * Get a file.
 *
 * @param path (String) the path to the file to read
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise that resolves to either raw data, or an extended mutable data response schema (if opts.extended is set).
 * If the file does not exist, then the Promise resolves to null.  Any other errors result in an Error being thrown.
 */
export function getFile(path, opts={}) {

   let blockchain_id = opts.blockchainID;

   if (!blockchain_id) {
      blockchain_id = getSessionBlockchainID();
   }
   
   return datastoreMount({'blockchainID': blockchain_id})
   .then((ds) => {
      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_list = getDeviceList(ds);
      const device_pubkeys = getPublicKeyList(ds);
      const options = {
         'method': 'GET',
         'host': ds.host,
         'port': ds.port,
         'path': `/v1/stores/${datastore_id}/files?path=${escape(sanitizePath(path))}&idata=1&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${blockchain_id}`,
      };

      let schema = 'bytes';

      if (!opts) {
         opts = {};
      }

      if (opts.extended) {
         options['path'] += '&extended=1';
         schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
      }

      if (opts.force) {
         options['path'] += '&force=1';
      }

      return httpRequest(options, schema)
      .then((response) => {
         if (response.error || response.errno) {
            // ENOENT?
            if (response.errno === ENOENT) {
               return null;
            }

            // some other error
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to getFile ${path} (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return response;
         }
      });
   });
}


/*
 * Execute a datastore operation
 *
 * @param ds (Object) a datastore context
 * @param operation (String) the specific operation being carried out.
 * @param path (String) the path of the operation
 * @param inodes (Array) the list of inode headers to replicate
 * @param payloads (Array) the list of inode payloads in 1-to-1 correspondence to the headers
 * @param signatures (Array) the list of signatures over each inode header (also 1-to-1 correspondence)
 * @param tombstones (Array) the list of signed inode tombstones
 *
 * Asynchronous; returns a Promise that resolves to True if the operation succeeded
 */
function datastoreOperation(ds, operation, path, inodes, payloads, signatures, tombstones) {

   let request_path = null;
   let http_operation = null;
   const datastore_id = ds.datastore_id;
   const datastore_privkey = ds.privkey_hex;
   const device_list = getDeviceList(ds);
   const device_pubkeys = getPublicKeyList(ds);

   assert(inodes.length === payloads.length);
   assert(payloads.length === signatures.length);

   if (operation === 'mkdir') {
      request_path = `/v1/stores/${datastore_id}/directories?path=${escape(sanitizePath(path))}&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${ds.blockchain_id}`;
      http_operation = 'POST';

      assert(inodes.length === 2);
   }
   else if (operation === 'putFile') {
      request_path = `/v1/stores/${datastore_id}/files?path=${escape(sanitizePath(path))}&device_ids=${device_list}&device_pubkeys=${device_pubkeys}&blockchain_id=${ds.blockchain_id}`;
      http_operation = 'PUT';

      assert(inodes.length === 1 || inodes.length === 2);
   }
   else if (operation === 'rmdir') {
      request_path = `/v1/stores/${datastore_id}/directories?path=${escape(sanitizePath(path))}&device_pubkeys=${device_pubkeys}&device_ids=${device_list}&blockchain_id=${ds.blockchain_id}`;
      http_operation = 'DELETE';

      assert(inodes.length === 1);
      assert(tombstones.length >= 1);
   }
   else if (operation === 'deleteFile') {
      request_path = `/v1/stores/${datastore_id}/files?path=${escape(sanitizePath(path))}&device_pubkeys=${device_pubkeys}&device_ids=${device_list}&blockchain_id=${ds.blockchain_id}`;
      http_operation = 'DELETE';

      assert(inodes.length === 1);
      assert(tombstones.length >= 1);
   }
   else {
      console.log(`invalid operation ${operation}`);
      throw new Error(`Invalid operation ${operation}`);
   }

   const options = {
      'method': http_operation,
      'host': ds.host,
      'port': ds.port,
      'path': request_path,
   };

   options['headers'] = {'Authorization': `bearer ${getSessionToken()}`}

   const datastore_str = JSON.stringify(ds.datastore);
   const datastore_sig = signRawData( datastore_str, datastore_privkey );

   const body_struct = {
      'inodes': inodes,
      'payloads': payloads,
      'signatures': signatures,
      'tombstones': tombstones,
      'datastore_str': datastore_str,
      'datastore_sig': datastore_sig,
   }

   const body = JSON.stringify(body_struct);
   options['headers']['Content-Type'] = 'application/json';
   options['headers']['Content-Length'] = body.length;

   return httpRequest(options, SUCCESS_FAIL_SCHEMA, body)
   .then((response) => {
      if (response.error || response.errno) {
         let errorMsg = response.error || 'UNKNOWN';
         let errorNo = response.errno || 'UNKNOWN';
         throw new Error(`Failed to ${operation} ${path} (errno: ${errorNo}): ${errorMsg}`);
      }
      else {
         return true;
      }
   });
}


/*
 * Given a path, get its parent directory
 * Make sure it's a directory.
 *
 * @param path (String) the path to the inode in question
 * @param opts (Object) lookup options
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise that resolves to the inode
 */
function getParent(path, opts={}) {
   const dirpath = dirname(path);
   return getInode(dirpath, opts)
   .then((response) => {
      if (!response) {
         return {'error': 'Failed to get parent', 'errno': EREMOTEIO};
      }

      let inode = response.inode_info.inode;

      if (inode.type !== MUTABLE_DATUM_DIR_TYPE) {
         return {'error': 'Not a directory', 'errno': ENOTDIR}
      }
      else {
         return inode;
      }
   },
   (error_resp) => {
      console.log(error_resp);
      return {'error': 'Failed to get inode', 'errno': EREMOTEIO};
   });
}


/*
 * Create or update a file
 *
 * @param path (String) the path to the file to create (must not exist)
 * @param file_buffer (Buffer or String) the file contents
 * @param opts (Object) lookup options
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise
 */
export function putFile(path, file_buffer, opts={}) {

   let blockchain_id = opts.blockchainID;

   if (!blockchain_id) {
      blockchain_id = getSessionBlockchainID();
   }

   return datastoreMountOrCreate()
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_id = ds.device_id;
      const privkey_hex = ds.privkey_hex;

      path = sanitizePath(path);
      const child_name = basename(path);

      assert(typeof(file_buffer) === 'string' || (file_buffer instanceof Buffer));

      // get parent dir
      return getParent(path, opts)
      .then((parent_dir) => {
         if (parent_dir.error) {
            throw new Error(`Failed to look up ${dirname(path)}: ${parent_dir.error}`);
         }

         // make the file inode information
         let file_payload = file_buffer;
         let file_hash = null;
         if (typeof(file_payload) !== 'string') {
            // buffer
            file_payload = file_buffer.toString('base64');
            file_hash = hashDataPayload( file_buffer.toString() );
         }
         else {
            // string
            file_payload = Buffer.from(file_buffer).toString('base64');
            file_hash = hashDataPayload( file_buffer );
         }

         assert(file_hash);

         let inode_uuid = null;
         let new_parent_dir_inode = null;
         let child_version = null;

         // new or existing?
         if (Object.keys(parent_dir['idata']['children']).includes(child_name)) {

            // existing; no directory change
            inode_uuid = parent_dir['idata']['children'][child_name]['uuid'];
            new_parent_dir_inode = inodeDirLink(parent_dir, MUTABLE_DATUM_FILE_TYPE, child_name, inode_uuid, true );
         }
         else {

            // new
            inode_uuid = uuid4();
            new_parent_dir_inode = inodeDirLink(parent_dir, MUTABLE_DATUM_FILE_TYPE, child_name, inode_uuid, false );
         }

         const version = getChildVersion(parent_dir, child_name);
         const inode_info = makeFileInodeBlob( datastore_id, datastore_id, inode_uuid, file_hash, device_id, version );
         const inode_sig = signDataPayload( inode_info['header'], privkey_hex );

         // make the directory inode information
         const new_parent_info = makeDirInodeBlob( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata']['children'], device_id, new_parent_dir_inode['version'] + 1);
         const new_parent_sig = signDataPayload( new_parent_info['header'], privkey_hex );

         // post them
         const new_parent_info_b64 = new Buffer(new_parent_info['idata']).toString('base64');
         return datastoreOperation(ds, 'putFile', path, [inode_info['header'], new_parent_info['header']], [file_payload, new_parent_info_b64], [inode_sig, new_parent_sig], []);
      });
   });
}


/*
 * Create a directory.
 *
 * @param path (String) path to the directory
 * @param opts (object) optional arguments
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise
 */
export function mkdir(path, opts={}) {

   return datastoreMountOrCreate()
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_id = ds.device_id;
      const privkey_hex = ds.privkey_hex;

      path = sanitizePath(path);
      const child_name = basename(path);

      return getParent(path, opts)
      .then((parent_dir) => {
         if (parent_dir.error) {
            throw new Error(`Failed to look up ${dirname(path)}: ${parent_dir.error}`);
         }

         // must not exist
         if (Object.keys(parent_dir['idata']['children']).includes(child_name)) {
            return {'error': 'File or directory exists', 'errno': EEXIST};
         }

         // make the directory inode information
         const inode_uuid = uuid4();
         const inode_info = makeDirInodeBlob( datastore_id, datastore_id, inode_uuid, {}, device_id);
         const inode_sig = signDataPayload( inode_info['header'], privkey_hex );

         // make the new parent directory information
         const new_parent_dir_inode = inodeDirLink(parent_dir, MUTABLE_DATUM_DIR_TYPE, child_name, inode_uuid);
         const new_parent_info = makeDirInodeBlob( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata']['children'], device_id, new_parent_dir_inode['version'] + 1);
         const new_parent_sig = signDataPayload( new_parent_info['header'], privkey_hex );

         // post them
         return datastoreOperation(ds, 'mkdir', path, [inode_info['header'], new_parent_info['header']], [inode_info['idata'], new_parent_info['idata']], [inode_sig, new_parent_sig], []);
      });
   });
}


/*
 * Delete a file
 *
 * @param path (String) path to the directory
 * @param opts (Object) options for this call
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise
 */
export function deleteFile(path, opts={}) {

   return datastoreMountOrCreate()
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_id = ds.device_id;
      const privkey_hex = ds.privkey_hex;
      const all_device_ids = ds.datastore.device_ids;

      path = sanitizePath(path);
      const child_name = basename(path);

      return getParent(path, opts)
      .then((parent_dir) => {
         if (parent_dir.error) {
            throw new Error(`Failed to look up ${dirname(path)}: ${parent_dir.error}`);
         }

         // no longer exists?
         if (!Object.keys(parent_dir['idata']['children']).includes(child_name)) {
            return {'error': 'No such file or directory', 'errno': ENOENT};
         }

         const inode_uuid = parent_dir['idata']['children'][child_name]['uuid'];

         // unlink
         const new_parent_dir_inode = inodeDirUnlink(parent_dir, child_name);
         const new_parent_info = makeDirInodeBlob( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata']['children'], device_id, new_parent_dir_inode['version'] + 1 );
         const new_parent_sig = signDataPayload( new_parent_info['header'], privkey_hex );

         // make tombstones
         const tombstones = makeInodeTombstones(datastore_id, inode_uuid, all_device_ids);
         const signed_tombstones = signMutableDataTombstones(tombstones, privkey_hex);

         // post them
         return datastoreOperation(ds, 'deleteFile', path, [new_parent_info['header']], [new_parent_info['idata']], [new_parent_sig], signed_tombstones);
      });
   });
}


/*
 * Remove a directory
 *
 * @param path (String) path to the directory
 * @param opts (Object) options for this call
 *      .blockchain_id (string) this is the blockchain ID of the datastore owner (if different from the session)
 *      .ds (datastore context) this is the mount context for the datastore, if different from one that we have cached
 *
 * Asynchronous; returns a Promise
 */
export function rmdir(path, opts={}) {

   return datastoreMountOrCreate()
   .then((ds) => {

      assert(ds);

      const datastore_id = ds.datastore_id;
      const device_id = ds.device_id;
      const privkey_hex = ds.privkey_hex;
      const all_device_ids = ds.datastore.device_ids;

      path = sanitizePath(path);
      const child_name = basename(path);

      return getParent(path, opts)
      .then((parent_dir) => {
         if (parent_dir.error) {
            throw new Error(`Failed to look up ${dirname(path)}: ${parent_dir.error}`);
         }

         // no longer exists?
         if (!Object.keys(parent_dir['idata']['children']).includes(child_name)) {
            return {'error': 'No such file or directory', 'errno': ENOENT};
         }

         const inode_uuid = parent_dir['idata']['children'][child_name]['uuid'];

         // unlink
         const new_parent_dir_inode = inodeDirUnlink(parent_dir, child_name);
         const new_parent_info = makeDirInodeBlob( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata']['children'], device_id, new_parent_dir_inode['version'] + 1 );
         const new_parent_sig = signDataPayload( new_parent_info['header'], privkey_hex );

         // make tombstones
         const tombstones = makeInodeTombstones(datastore_id, inode_uuid, all_device_ids);
         const signed_tombstones = signMutableDataTombstones(tombstones, privkey_hex);

         // post them
         return datastoreOperation(ds, 'rmdir', path, [new_parent_info['header']], [new_parent_info['idata']], [new_parent_sig], signed_tombstones);
      });
   });
}
