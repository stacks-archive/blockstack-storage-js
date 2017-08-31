'use strict'    

import {
   selectDrivers,
   REPLICATION_STRATEGY_CLASSES,
   SUPPORTED_STORAGE_CLASSES
} from './policy';

import {
   httpRequest
} from './requests';

import {
   getDeviceRoot,
   getRoot,
   getFileHeader,
   getFileData,
   putDeviceRoot,
   putFileData,
   deleteFileData,
   getProfileData,
} from './api';

import {
   SUCCESS_FAIL_SCHEMA,
   ROOT_DIRECTORY_LEAF,
   ROOT_DIRECTORY_PARENT,
   ROOT_DIRECTORY_ENTRY_SCHEMA,
   ROOT_DIRECTORY_SCHEMA,
   FILE_LOOKUP_RESPONSE,
   GET_DEVICE_ROOT_RESPONSE,
   GET_ROOT_RESPONSE,
   PUT_DATASTORE_RESPONSE,
   PUT_DATA_RESPONSE,
   DATASTORE_SCHEMA,
   DATASTORE_RESPONSE_SCHEMA,
   CORE_ERROR_SCHEMA,
} from './schemas';


import {
   makeDataInfo,
   signDataPayload,
   signRawData,
   hashDataPayload,
   hashRawData,
   makeDataTombstones,
   signDataTombstones,
} from './blob';

import {
   makeEmptyDeviceRootDirectory,
} from './inode';

import {
   jsonStableSerialize,
   decodePrivateKey,
   decompressPublicKey,
   getPubkeyHex,
   splitHostPort
} from './util';


import {
   getSessionToken,
   getSessionAppName,
   getSessionBlockchainID,
   getCachedMountContext,
   getBlockchainIDFromSessionOrDefault,
   getUserData,
   setUserData,
   setCachedMountContext,
} from './metadata';


const http = require('http');
const uuid4 = require('uuid/v4');
const bitcoinjs = require('bitcoinjs-lib');
const BigInteger = require('bigi');
const Promise = require('promise');
const assert = require('assert');
const Ajv = require('ajv');
const jsontokens = require('jsontokens');
const urlparse = require('url');

/*
 * Convert a datastore public key to its ID.
 * @param ds_public_key (String) hex-encoded ECDSA public key
 */
export function datastoreGetId( ds_public_key_hex) {
    let ec = bitcoinjs.ECPair.fromPublicKeyBuffer( Buffer.from(ds_public_key_hex, 'hex') );
    return ec.getAddress();
}


/*
 * Create the signed request to create a datastore.
 * This information can be fed into datastoreCreate()
 * Returns an object with:
 *      .datastore_info: datastore information
 *      .datastore_sigs: signatures over the above.
 */
export function datastoreCreateRequest(ds_type, ds_private_key_hex, drivers, device_id, all_device_ids) {

   assert(ds_type === 'datastore' || ds_type === 'collection');
   const root_uuid = uuid4();

   const ds_public_key = getPubkeyHex(ds_private_key_hex);
   const datastore_id = datastoreGetId( ds_public_key );

   // make empty device root
   const device_root = makeEmptyDeviceRootDirectory(datastore_id, []);
   const device_root_data_id = `${datastore_id}.${root_uuid}`;
   const device_root_blob = makeDataInfo(device_root_data_id, jsonStableSerialize(device_root), device_id);
   const device_root_str = jsonStableSerialize(device_root_blob);

   // actual datastore payload
   const datastore_info = {
      'type': ds_type,
      'pubkey': ds_public_key,
      'drivers': drivers,
      'device_ids': all_device_ids,
      'root_uuid': root_uuid,
   };

   const data_id = `${datastore_id}.datastore`;
   const datastore_blob = makeDataInfo(data_id, jsonStableSerialize(datastore_info), device_id);
   const datastore_str = jsonStableSerialize(datastore_blob);

   // sign them all
   const root_sig = signDataPayload( device_root_str, ds_private_key_hex );
   const datastore_sig = signDataPayload( datastore_str, ds_private_key_hex );

   // make and sign tombstones for the root
   const root_data_id = `${datastore_id}.${root_uuid}`;
   const root_tombstones = makeDataTombstones(all_device_ids, root_data_id)
   const signed_tombstones = signDataTombstones(root_tombstones, ds_private_key_hex);

   const info = {
      'datastore_info': {
         'datastore_blob': datastore_str,
         'root_blob': device_root_str,
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
          'root_blob': datastore_request.datastore_info.root_blob,
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

      const app_name = getSessionAppName();
      assert(app_name);

      ds = getCachedMountContext(blockchain_id, app_name);
      assert(ds);
   }

   const datastore_id = ds.datastore_id;
   const device_ids = ds.datastore.device_ids;
   const root_uuid = ds.datastore.root_uuid;
   const data_id = `${datastore_id}.datastore`;
   const root_data_id = `${datastore_id}.${root_uuid}`;

   const tombstones = makeDataTombstones( device_ids, data_id );
   const signed_tombstones = signDataTombstones( tombstones, ds.privkey_hex );

   const root_tombstones = makeDataTombstones(device_ids, root_data_id);
   const signed_root_tombstones = signDataTombstones( root_tombstones, ds.privkey_hex );

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
      const session = jsontokens.decodeToken(getSessionToken()).payload;
      const blockchain_id = getSessionBlockchainIDOrDefault(session);
      assert(blockchain_id);

      const app_name = getSessionAppName();
      assert(app_name);

      ds = getCachedMountContext(blockchain_id, app_name);
      assert(ds);
   }

   if (!ds_tombstones || !root_tombstones) {
      const delete_info = datastoreDeleteRequest(ds);
      ds_tombstones = delete_info['datastore_tombstones'];
      root_tombstones = delete_info['root_tombstones'];
   }

   const payload = {
      'datastore_tombstones': ds_tombstones,
      'root_tombstones': root_tombstones,
   };

   const options = {
      'method': 'DELETE',
      'host': ds.host,
      'port': ds.port,
      'path': '/v1/stores',
   };

   options['headers'] = {'Authorization': `bearer ${getSessionToken()}`}

   const body = JSON.stringify(payload);
   options['headers']['Content-Type'] = 'application/json';
   options['headers']['Content-Length'] = body.length;

   return httpRequest(options, SUCCESS_FAIL_SCHEMA, body);
}


/*
 * Are we in single-reader storage?
 * i.e. does this device's session token own this datastore?
 */
function isSingleReaderMount(sessionToken, datastore_id) {
   const blockchain_id = getSessionBlockchainID(sessionToken);

   if (!blockchain_id) {
      // no blockchain ID given means we can't be in multi-reader storage mode
      return true;
   }

   if (datastore_id === sessionToken.app_user_id) {
      // the session token indicates that the datastore we're mounting was, in fact,
      // created by this device.  We can use datastore IDs and device IDs.
      return true;
   }

   return false;
}


/*
 * Make a request's query string for either single-reader
 * or multi-reader storage, given the datastore mount context.
 *
 * Returns {'store_id': ..., 'qs': ..., 'host': ..., 'port': ...} on success
 * Throws on error.
 */
export function datastoreRequestPathInfo(dsctx) {

   assert( (dsctx.blockchain_id && dsctx.app_name) || (dsctx.datastore_id) );

   if (!dsctx.blockchain_id && !dsctx.app_name) {

      // single-reader mode
      let device_ids = [];
      let public_keys = [];

      for (let apk of dsctx['app_public_keys']) {
         device_ids.push(apk['device_id']);
         public_keys.push(apk['public_key']);
      }

      let device_ids_str = device_ids.join(',');
      let public_keys_str = public_keys.join(',');

      let info = {
         'store_id': dsctx.datastore_id,
         'qs': `device_ids=${device_ids_str}&device_pubkeys=${public_keys_str}`,
         'host': dsctx.host,
         'port': dsctx.port,
      };
      
      return info;
   }
   else {
      
      // multi-reader mode 
      let info = {
         'store_id': dsctx.app_name,
         'qs': `blockchain_id=${dsctx.blockchain_id}`,
         'host': dsctx.host,
         'port': dsctx.port,
      };

      return info;
   }
}


/*
 * Look up a datastore and establish enough contextual information to do subsequent storage operations.
 * Asynchronous; returns a Promise
 *
 * opts is an object that must contain EITHER:
 * * a single-reader datastore identifier, which is:
 * * * datastoreID (string) the datastore ID
 * * * deviceID (string) this device ID
 * * * dataPubkeys (array) this is an array of {'device_id': ..., 'public_key': ...} objects, where one such object has `device_id` equal to opts.device_id
 * OR
 * * a multi-reader datastore identifier, which is:
 * * * appName (string) the application name
 * * * blockchainID (string) the blockchain ID that owns the datastore
 * 
 * If we're going to write to this datastore, then we *additionally* need:
 * * appPrivateKey (string) the application private key
 * * sessionToken (string) the session JWT (optional)
 *
 * sessionToken may be given as an opt, in which case the following fields will be used
 * if not provided in opts:
 * * appName from session.app_domain
 * * blockchainID from session.blockchain_id
 * * dataPubkeys from session.app_public_keys
 * * deviceID from session.device_id
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
   let app_name = opts.appName;
   let candidate_datastore_id = opts.datastoreID;
   let this_device_id = opts.deviceID;
   let app_public_keys = opts.dataPubkeys;

   let session_blockchain_id = getSessionBlockchainID(sessionToken);
   let api_endpoint = null;
   if (data_privkey_hex) {
      candidate_datastore_id = datastoreGetId(getPubkeyHex(data_privkey_hex));
   }

   if (!sessionToken) {
      sessionToken = getSessionToken();
      assert(sessionToken);
   }
      
   const session = jsontokens.decodeToken(sessionToken).payload;
   const session_app_name = getSessionAppName(sessionToken);

   // will be set on single-reader mount
   let datastore_id = null;

   // will be set on multi-reader mount
   let datastore_blockchain_id = null;

   // maybe cached?
   if (!no_cache) {
       let ds = getCachedMountContext(getBlockchainIDFromSessionOrDefault(session), session_app_name);
       if (ds) {
          return new Promise((resolve, reject) => { resolve(ds); });
       }
   }

   // not cached.  setup from session token
   if (!this_device_id) {
       this_device_id = session.device_id;
       assert(this_device_id);
   }

   if (!app_public_keys) {
       app_public_keys = session.app_public_keys;
   }

   api_endpoint = session.api_endpoint;

   if (isSingleReaderMount(sessionToken, candidate_datastore_id)) {

      // single-reader info
      datastore_blockchain_id = null;
      datastore_id = candidate_datastore_id;
   }
   else {

      // multi-reader info
      assert(app_name || session, 'Need either appName or sessionToken in opts');
      if (!app_name && session) {
          app_name = getSessionAppName(sessionToken);
      }

      datastore_blockchain_id = (blockchain_id ? blockchain_id : session_blockchain_id);
      datastore_id = null;
   }

   assert((datastore_blockchain_id && app_name) || (datastore_id), `Need either blockchain_id (${datastore_blockchain_id}) / app_name (${app_name}) or datastore_id (${datastore_id})`);
   
   if (api_endpoint.indexOf('://') < 0) {
      let new_api_endpoint = 'https://' + api_endpoint;
      if (urlparse.parse(new_api_endpoint).hostname === 'localhost') {
         new_api_endpoint = 'http://' + api_endpoint;
      }

      api_endpoint = new_api_endpoint;
   }

   const urlinfo = urlparse.parse(api_endpoint);
   const blockstack_hostport = urlinfo.host;
   const scheme = urlinfo.protocol.replace(':','');
   const host = urlinfo.hostname;
   const port = urlinfo.port;

   const ctx = {
      'scheme': scheme,
      'host': host,
      'port': port,
      'blockchain_id': datastore_blockchain_id,
      'app_name': app_name,
      'datastore_id': datastore_id,
      'app_public_keys': app_public_keys,
      'device_id': this_device_id,
      'datastore': null,
      'privkey_hex': null,
   };

   if (data_privkey_hex) {
      ctx.privkey_hex = data_privkey_hex;
   }

   const path_info = datastoreRequestPathInfo(ctx);
   const options = {
      'method': 'GET',
      'host': path_info.host,
      'port': path_info.port,
      'path': `/v1/stores/${path_info.store_id}?${path_info.qs}`,
   }

   console.log(`Mount datastore ${options.path}`);
   options['headers'] = {'Authorization': `bearer ${sessionToken}`};

   return httpRequest(options, DATASTORE_RESPONSE_SCHEMA).then((ds) => {
      if (!ds || ds.error) {
         // ENOENT?
         if (!ds || ds.errno === 'ENOENT') {
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
         if (!userData.coreSessionToken && sessionToken) {
            console.log("In test framework; saving session token");
            userData.coreSessionToken = sessionToken;

            if (data_privkey_hex) {
                userData.appPrivateKey = data_privkey_hex;
            }

            setUserData(userData);
         }

         // save
         setCachedMountContext(getBlockchainIDFromSessionOrDefault(session), session_app_name, ctx);
         return ctx;
      }
   });
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
   const session_blockchain_id = getBlockchainIDFromSessionOrDefault(session);
   const session_app_name = getSessionAppName(sessionToken);

   // cached?
   let ds = getCachedMountContext(session_blockchain_id, session_app_name);
   if (ds) {
      return new Promise((resolve, reject) => { resolve(ds); });
   }

   // no cached datastore context.
   // go ahead and create one (need appPrivateKey)
   if (!appPrivateKey) {
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
   let app_name = getSessionAppName(sessionToken);

   // find satisfactory storage drivers
   if (Object.keys(session.storage.preferences).includes(app_name)) {

      // app-specific preference
      drivers = session.storage.preferences[app_name];
   }
   else {

      // select defaults given the replication strategy
      drivers = selectDrivers(replication_strategy, session.storage.classes);
   }

   let api_endpoint = session.api_endpoint;
 
   if (api_endpoint.indexOf('://') < 0) {
      let new_api_endpoint = 'https://' + api_endpoint;
      if (urlparse.parse(new_api_endpoint).hostname === 'localhost') {
         new_api_endpoint = 'http://' + api_endpoint;
      }

      api_endpoint = new_api_endpoint;
   }

   const hostport = urlparse.parse(api_endpoint).host;
   const appPublicKeys = session.app_public_keys;
   const deviceID = session.device_id;
   const allDeviceIDs = [];

   for (let apk of appPublicKeys) {
      allDeviceIDs.push(apk['device_id']);
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

         const info = datastoreCreateRequest('datastore', appPrivateKey, drivers, deviceID, allDeviceIDs);

         // go create it
         return datastoreCreate(hostport, sessionToken, info)
         .then((res) => {
            if (res.error) {
               console.log(res.error);
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


