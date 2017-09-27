'use strict'

import {
   CORE_ERROR_SCHEMA,
   GET_PROFILE_RESPONSE,
   PUT_DATA_RESPONSE,
   GET_DEVICE_ROOT_RESPONSE,
   GET_ROOT_RESPONSE,
   FILE_LOOKUP_RESPONSE,
   SUCCESS_FAIL_SCHEMA,
} from './schemas';

import {
   hashDataPayload,
   signDataPayload,
   makeDataInfo,
   makeDataTombstone,
   makeDataTombstones,
   signDataTombstones,
   signRawData,
} from './blob';

import {
   selectDrivers
} from './policy';

import {
   makeEmptyDeviceRootDirectory,
   makeFileEntry,
   deviceRootInsert,
   deviceRootRemove,
} from './inode';

import {
   jsonStableSerialize,
} from './util';

import {
   decompressPublicKey,
   getPubkeyHex
} from 'blockstack';

import {
   datastoreMount,
   datastoreMountOrCreate,
   datastoreGetId,
   datastoreRequestPathInfo,
} from './datastore';

import {
   httpRequest
} from './requests';

import {
   getSessionToken,
   getCachedMountContext,
   getBlockchainIDFromSessionOrDefault,
   getSessionBlockchainID,
   getSessionAppName,
   getSessionDeviceID,
   getDeviceRootVersion,
   putDeviceRootVersion,
   getSessionDatastoreID
} from './metadata';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const uuid4 = require('uuid/v4');
const bitcoinjs = require('bitcoinjs-lib');
const BigInteger = require('bigi');
const Promise = require('promise');
const jsontokens = require('jsontokens');
const urlparse = require('url');

/*
 * Get the device-specific root directory page
 * Need either blockchain_id and full_app_name, or datastore_id and data_pubkeys.
 *
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 * @datastore_id (string) the datastore ID
 * @data_pubkeys (array) a list of {'device_id': ..., 'public_key': ...} objects
 * @force (boolean) if true, then tolerate stale data.
 *
 * Returns a Promise that resolves to the device root (an object that conforms to GET_DEVICE_ROOT_RESPONSE)
 */
function getDeviceRoot(device_id, opts) {
    
   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let datastore_id = opts.datastore_id || null;
   let data_pubkeys = opts.data_pubkeys || null;
   let force = opts.force || false;

   assert((datastore_id && data_pubkeys) || (blockchain_id && full_app_name), 'Need either both datastore_id/data_pubkeys or full_app_name/blockchain_id');

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id, 'dataPubkeys': data_pubkeys})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'GET',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${reqinfo.store_id}/device_roots?force=${force ? '1' : '0'}&this_device_id=${device_id}&${reqinfo.qs}`,
      };

      console.log(`get_device_root: ${options.path}`);

      return httpRequest(options, GET_DEVICE_ROOT_RESPONSE)
      .then((response) => {
         if (response.error || response.errno) {
            // ENOENT?
            if (response.errno === 'ENOENT') {
               return response;
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
 * Get the entire datastore's root directory.
 * Need either blockchain_id and full_app_name, or datastore_id and data_pubkeys.
 *
 * opts:
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 * @datastore_id (string) the datastore ID
 * @data_pubkeys (array) a list of {'device_id': ..., 'public_key': ...} objects
 * @force (boolean) if true, then tolerate stale data.
 *
 * Returns a Promise that resolves to the datastore root (an object that conforms to GET_ROOT_RESPONSE)
 */
function getRoot(opts) {

   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let datastore_id = opts.datastore_id || null;
   let data_pubkeys = opts.data_pubkeys || null;
   let force = opts.force || false;

   assert((datastore_id && data_pubkeys) || (blockchain_id && full_app_name), 'Need either both datastore_id/data_pubkeys or full_app_name/blockchain_id');

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id, 'dataPubkeys': data_pubkeys})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'GET',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${reqinfo.store_id}/listing?force=${force ? '1': '0'}&${reqinfo.qs}`,
      };

      console.log(`get_root: ${options.path}`);

      return httpRequest(options, GET_ROOT_RESPONSE)
      .then((response) => {
         if (response.error || response.errno) {
            // ENOENT?
            if (response.errno === 'ENOENT') {
               return response;
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
 * Get a file's header.
 * Need either blockchain_id or full_app_name, or datastore_id and data_pubkeys
 *
 * @file_name (string) the name of the file to query
 * @device_id (string) this device ID
 *
 * opts:
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 * @datastore_id (string) the datastore ID
 * @data_pubkeys (array) a list of {'device_id': ..., 'public_key': ...} objects
 * @force (boolean) if true, then tolerate stale data.
 *
 * Returns a Promise that resolves to the file header (an object that conforms to FILE_LOOKUP_RESPONSE)
 */
function getFileHeader(file_name, device_id, opts) {

   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let datastore_id = opts.datastore_id || null;
   let data_pubkeys = opts.data_pubkeys || null;
   let force = opts.force || false;

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id, 'dataPubkeys': data_pubkeys})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'GET',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${reqinfo.store_id}/headers?path=${file_name}&force=${force ? '1': '0'}&this_device_id=${device_id}&${reqinfo.qs}`,
      };

      console.log(`get_file_header: ${options.path}`);

      return httpRequest(options, FILE_LOOKUP_RESPONSE)
      .then((response) => {
         if (response.error || response.errno) {
            // ENOENT?
            if (response.errno === 'ENOENT') {
               return response;
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
 * Get raw file data.
 * Need either blockchain_id or full_app_name, or datastore_id and data_pubkeys
 *
 * @file_name (string) the name of the file to query
 *
 * opts:
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 * @datastore_id (string) the datastore ID
 * @data_pubkeys (array) a list of {'device_id': ..., 'public_key': ...} objects
 * @force (boolean) if true, then tolerate stale data.
 *
 * Returns a Promise that resolves to the file data
 */
function getFileData(file_name, opts) {

   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let datastore_id = opts.datastore_id || null;
   let data_pubkeys = opts.data_pubkeys || null;
   let force = opts.force || false;

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id, 'dataPubkeys': data_pubkeys})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'GET',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${reqinfo.store_id}/files?path=${file_name}&force=${force ? '1': '0'}&${reqinfo.qs}`,
      };

      console.log(`get_file: ${options.path}`);

      return httpRequest(options, 'bytes')
      .then((response) => {
         if (response.error || response.errno) {
            // ENOENT?
            if (response.errno === 'ENOENT') {
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
 * Create or put a whole file.
 *
 * @datastore_str (string) serialized mutable data blob encoding the datastore we're working on 
 * @datastore_sig (string) the signature over datastore_str with this device's private key 
 * @file_name (string) the name of this file 
 * @file_header_blob (string) the serialized header for this file (with no URLs set)
 * @payload_b64 (string or Buffer) the raw data, base64-encoded
 * @signature (string) the signature over @file_header_blob
 *
 * opts:
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 * @force (boolean) if true, then tolerate stale data.
 *
 * Returns a Promise that resolves to the list of URLs on success (PUT_DATA_RESPONSE)
 */
function putFileData(datastore_str, datastore_sig, file_name, file_header_blob, payload_b64, signature, opts) {

   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let force = opts.force || null;

   let datastore = JSON.parse(datastore_str);
   let datastore_id = datastoreGetId(datastore['pubkey']);

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'POST',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${datastore_id}/files?path=${file_name}&${reqinfo.qs}`,
         'headers':  {'Authorization': `bearer ${getSessionToken()}`}
      };

      const request_body = {
         'headers': [file_header_blob],
         'payloads': [payload_b64],
         'signatures': [signature],
         'tombstones': [],
         'datastore_str': datastore_str,
         'datastore_sig': datastore_sig,
      };

      console.log(`put_file: ${options.path}`);

      const body = JSON.stringify(request_body);
      options['headers']['Content-Type'] = 'application/json';
      options['headers']['Content-Length'] = body.length;

      return httpRequest(options, PUT_DATA_RESPONSE, body)
      .then((response) => {
         if (response.error || response.errno) {
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to put file ${file_name} (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return response;
         }
      });
   });
}


/*
 * Put a new device root 
 *
 * @datastore_str (string) serialized mutable data blob encoding the datastore we're working on 
 * @datastore_sig (string) the signature over datastore_str with this device's private key 
 * @device_root_page_blob (string) the mutable data blob containing the new device root
 * @signature (string) the signature over @device_root_page_blob
 *
 * opts:
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 * @sync (boolean) if true, then write the device root synchronously
 *
 * Returns a Promise that resolves to the list of URLs to the replicas (PUT_DATA_RESPONSE)
 */
function putDeviceRoot(datastore_str, datastore_sig, device_root_page_blob, signature, opts) {

   let blockchain_id = opts.blockchain_id || getSessionBlockchainID();
   let full_app_name = opts.full_app_name || getSessionAppName();
   let sync = opts.sync || false;

   let datastore = JSON.parse(datastore_str);
   let datastore_id = datastoreGetId(datastore['pubkey']);

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'POST',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${datastore_id}/device_roots?sync=${sync ? '1' : '0'}&${reqinfo.qs}`,
         'headers':  {'Authorization': `bearer ${getSessionToken()}`}
      };

      const request_body = {
         'headers': [],
         'payloads': [device_root_page_blob],
         'signatures': [signature],
         'tombstones': [],
         'datastore_str': datastore_str,
         'datastore_sig': datastore_sig,
      };

      console.log(`put_device_root: ${options.path}`);

      const body = JSON.stringify(request_body);
      options['headers']['Content-Type'] = 'application/json';
      options['headers']['Content-Length'] = body.length;

      return httpRequest(options, PUT_DATA_RESPONSE, body)
      .then((response) => {
         if (response.error || response.errno) {
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to put device root (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return true;
         }
      });
   });
}


/*
 * Delete a whole file.
 *
 * @datastore_str (string) serialized mutable data blob encoding the datastore we're working on 
 * @datastore_sig (string) the signature over datastore_str with this device's private key
 * @signed_tombstones (array) the list of signed tombstones for this file
 *
 * opts:
 * @blockchain_id (string) the blockchain ID that owns the datastore
 * @full_app_name (string) the fully-qualified application name
 *
 * Returns a Promise that resolves to true
 */
function deleteFileData(datastore_str, datastore_sig, signed_tombstones, opts) { 

   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;

   let datastore = JSON.parse(datastore_str);
   let datastore_id = datastoreGetId(datastore['pubkey']);

   return datastoreMount({'blockchainID': blockchain_id, 'appName': full_app_name, 'datastoreID': datastore_id})
   .then((ds) => {
      assert(ds, 'No datastore returned');

      const reqinfo = datastoreRequestPathInfo(ds);
      const options = {
         'method': 'DELETE',
         'host': reqinfo.host,
         'port': reqinfo.port,
         'path': `/v1/stores/${datastore_id}/files?${reqinfo.qs}`,
         'headers':  {'Authorization': `bearer ${getSessionToken()}`}
      };

      const request_body = {
         'headers': [],
         'payloads': [],
         'signatures': [],
         'tombstones': signed_tombstones,
         'datastore_str': datastore_str,
         'datastore_sig': datastore_sig,
      };

      console.log(`delete_file: ${options.path}`);

      const body = JSON.stringify(request_body);
      options['headers']['Content-Type'] = 'application/json';
      options['headers']['Content-Length'] = body.length;

      return httpRequest(options, SUCCESS_FAIL_SCHEMA, body)
      .then((response) => {
         if (response.error || response.errno) {
            let errorMsg = response.error || 'UNKNOWN';
            let errorNo = response.errno || 'UNKNOWN';
            throw new Error(`Failed to put device root (errno: ${errorNo}): ${errorMsg}`);
         }
         else {
            return true;
         }
      });
   });
}

/*
 * Get profile, zone file, and name record information 
 *
 * @blockchain_id (string) the blockchain ID
 *
 * Returns a promise that resolves to {'profile': ..., 'name_record': ...,}, with either 'zoenfile' or 'zonefile_b64' defined
 */
function getProfileData(blockchain_id) {

   const sessionToken = getSessionToken();
   assert(sessionToken);

   const urlinfo = urlparse.parse(sessionToken.api_endpoint);
   const host = urlinfo.hostname;
   const port = urlinfo.port;

   const options = {
      'method': 'GET',
      'host': host,
      'port': port,
      'path': `/v1/names/${blockchain_id}/profile`,
   }

   console.log(`get_profile: ${options.path}`);

   return httpRequest(options, GET_PROFILE_RESPONSE)
   .then((response) => {
      if (response.error || response.errno) {
         let errorMsg = response.error || 'UNKNOWN';
         let errorNo = response.errno || 'UNKNOWN';
         throw new Error(`Failed to put device root (errno: ${errorNo}): ${errorMsg}`);
      }
      else {
         return response;
      }
   });
}


/*
 * Go look up the device root page
 *
 * @this_device_id (string): this device ID
 *
 * opts:
 * @blockchain_id (string): blockchain ID that owns the datastore
 * @full_app_name (string): name of the application that uses the datastore
 * @datastore_id (string): datastore ID
 * @data_pubkeys (array): array of device/datapubkey pairs
 * @force (boolean): tolerate stale data or not
 *
 * Returns a Promise that resolves to either:
 * {'status': True, 'device_root': ..., 'datastore': ..., 'created': true/false}
 * {'error': ..., 'errno': ...}
 */
function findDeviceRootInfo(this_device_id, opts) {
   
   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let datastore_id = opts.datastore_id || null;
   let data_pubkeys = opts.data_pubkeys || null;
   let force = opts.force || false;

   // look up datastore info 
   return findDatastoreInfo(this_device_id, {'blockchain_id': blockchain_id, 'full_app_name': full_app_name, 'datastore_id': datastore_id, 'data_pubkeys': data_pubkeys, 'force': force})
   .then((dsinfo) => {
      
      if (dsinfo['error'] || dsinfo['errno']) {
         return dsinfo;
      }

      let datastore = dsinfo['datastore'];
      let data_pubkey = dsinfo['data_pubkey'];

      if (!data_pubkeys) {
          data_pubkeys = dsinfo['data_pubkeys'];
      }

      let datastore_id = datastoreGetId(datastore['pubkey']);
      let root_uuid = datastore['root_uuid'];
      let drivers = datastore['drivers'];

      // do we expect this device root to exist already?  we might not, if this is the first time we're trying to modify the device root
      let expect_device_root = false;
      if (decompressPublicKey(datastore['pubkey']) === decompressPublicKey(data_pubkey)) {
          // we created this 
          console.log(`This device ${this_device_id} created datastore ${datastore_id}, so we expect its root to exist`);
          expect_device_root = true;
      }

      let root_version = getDeviceRootVersion(datastore_id, root_uuid, [this_device_id]);
      if (root_version > 0) {
          // previously seen or written 
          console.log(`This device ${this_device_id} has seen version ${root_version} for ${datastore_id}, so we expect the root to exist`);
          expect_device_root = true;
      }
      
      return getDeviceRoot(this_device_id, {blockchain_id: blockchain_id, full_app_name: full_app_name, datastore_id: datastore_id, data_pubkeys: data_pubkeys, force: force})
      .then((res) => {

         let created = false;
         let device_root = null;

         if (res['error'] || res['errno']) {
            console.log(`Failed to get device ${this_device_id} root page for ${datastore_id}.${root_uuid}: ${res['error']}`);
            if (expect_device_root) {
                return res;
            }
            else {
                console.log(`Creating empty device root for ${this_device_id}`);

                device_root = makeEmptyDeviceRootDirectory(datastore_id, []);
                created = true;
            }
         }
         else {
            device_root = res['device_root_page'];
         }

         return {'status': true, 'device_root': device_root, 'created': created, 'datastore': datastore}
      });
   });
}


/*
 * Get application public key listing
 *
 * @blockchain_id (string): blockchain ID that owns this datastore
 * @full_app_name (string): full application name
 */
function getAppKeys(blockchain_id, full_app_name, data_pubkeys) {
   if (data_pubkeys) {
      return new Promise((resolve, reject) => {resolve(data_pubkeys);});
   }
   else {
      return getProfileData(blockchain_id)
      .then((res) => {

         if (res.error || res.errno) {
            console.log(`Failed to get profile data for ${blockchain_id}: ${res.error}`);
            return res;
         }

         // TODO: actually parse and verify the key file,
         // but for now, since we asked a trusted node, 
         // just extract the key file data 

         const profile_jwt = res['profile'];
         if (typeof(profile_jwt) !== 'string') {
            console.log(`Legacy profile for ${blockchain_id}: not a string`);
            return {'error': `Legacy profile for ${blockchain_id}: not a string`}
         }

         try {
            const profile = jsontokens.decodeToken(profile_jwt)['payload'];
            assert(profile, 'Failed to decode profile JWT: No payload field');

            const keyfile_jwt = profile['keyfile'];
            assert(keyfile_jwt, 'Failed to decode profile JWT: no keyfile field');

            const keyfile = jsontokens.decodeToken(keyfile_jwt)['payload'];
            assert(keyfile, 'Failed to decode keyfile JWT: no payload field');

            const keyfile_apps = keyfile['keys']['apps'];
            assert(keyfile_apps, 'No "apps" field in keyfile');
           
            data_pubkeys = []
            const device_ids = Object.keys(keyfile_apps);
            for (const dev_id of device_ids) {
               const dev_listing = jsontokens.decodeToken(keyfile_apps[dev_id])['payload'];
               if (!dev_listing[full_app_name]) {
                  continue;
               }

               const apk = {
                  'device_id': dev_id,
                  'public_key': dev_listing[full_app_name]['public_key'],
               };

               data_pubkeys.push(apk);
            }

            return data_pubkeys;
         }
         catch(e) {
            console.log(e);
            console.log(JSON.stringify(e));
            throw e;
         }
      });
   }
}


/*
 * Find datastore info
 *
 * opts:
 * @blockchain_id (string): blockchain ID that owns the datastore
 * @full_app_name (string): name of the application that uses the datastore
 * @datastore_id (string): datastore ID
 * @data_pubkeys (array): array of device/datapubkey pairs
 * @force (boolean): tolerate stale data or not
 *
 */
function findDatastoreInfo(this_device_id, opts) {

   let blockchain_id = opts.blockchain_id || null;
   let full_app_name = opts.full_app_name || null;
   let datastore_id = opts.datastore_id || null;
   let data_pubkeys = opts.data_pubkeys || null;
   let force = opts.force || false;

   assert((full_app_name && blockchain_id) || (datastore_id && data_pubkeys), 'Need either blockchain_id/full_app_name or datastore_id/data_pubkeys');

   return getAppKeys(full_app_name, blockchain_id, data_pubkeys)
   .then((data_pubkeys) => {

       const device_ids = Object.keys(data_pubkeys);
       return datastoreMount({'blockchainID': blockchain_id, 'full_app_name': full_app_name, 'dataPubkeys': data_pubkeys, 'datastoreID': datastore_id, 'deviceID': this_device_id})
       .then((ds) => {

          const datastore = ds.datastore;
          const datastore_id = datastoreGetId(datastore['pubkey']);
          const root_uuid = datastore['root_uuid'];
          const drivers = datastore['drivers'];

          // find this device's public key 
          let data_pubkey = null;
          for (const dpk of data_pubkeys) {
             if (dpk['device_id'] === this_device_id) {
                data_pubkey = dpk['public_key'];
                break;
             }
          }

          if (!data_pubkey) {
             return {'error': 'Failed to look up public key for this device'}
          }

          const ret = {
             'status': true,
             'datastore': datastore,
             'data_pubkeys': data_pubkeys,
             'data_pubkey': data_pubkey
          };

          return ret;
       });
   });
}


/*
 * Get a file.
 *
 * @file_name (string) the name of the file
 *
 * opts:
 * @blockchainID (string) the owner of the remote datastore
 * @force (string) if true, tolerate stale data
 *
 * Returns a Promise that resolves to the data, or null if not found.
 * Throws an exception on network or storage errors
 */
export function getFile(file_name, opts = {}) {
   const blockchain_id = opts.blockchainID || getSessionBlockchainID();
   const app_name = getSessionAppName();
   const datastore_id = getSessionDatastoreID();
   const force = opts.force || false;

   return getFileData(file_name, {'blockchain_id': blockchain_id, 'datastore_id': datastore_id, 'full_app_name': app_name, 'force': force});
}


/*
 * Put a file
 *
 * @file_name (string) the name of the file
 * @file_data (buffer) the data to store
 *
 * opts:
 * sync (boolean) synchronously store the new device root directory page (default: false)
 *
 * Returns a promise that resolves to file URLs
 */
export function putFile(file_name, file_buffer, opts = {}) {

   const blockchain_id = getSessionBlockchainID();
   const app_name = getSessionAppName();
   const sync = opts.sync || false;

   return datastoreMountOrCreate()
   .then((ds) => {
      
      assert(ds, 'No datastore mounted or created');

      let datastore = ds.datastore;
      let datastore_id = ds.datastore_id;
      let root_uuid = null;

      const device_id = ds.device_id;
      const privkey_hex = ds.privkey_hex;
      const data_pubkeys = ds.app_public_keys;

      assert(privkey_hex, 'No private key for datastore');
      assert(device_id, 'No device ID given');
      assert(data_pubkeys, 'No device public keys given');

      // look up current device root
      return findDeviceRootInfo(device_id, {'blockchain_id': blockchain_id, 'full_app_name': app_name, 'datastore_id': datastore_id, 'data_pubkeys': data_pubkeys})
      .then((root_info) => {

         if (root_info.error) {
            console.log(`Failed to load device root for datastore ${datastore_id}, device ${device_id}`);
            return root_info;
         }
         
         datastore = root_info['datastore']
         datastore_id = datastoreGetId(datastore['pubkey']);
         root_uuid = datastore['root_uuid'];
         
         const device_root = root_info['device_root'];
          
         // serialize 
         const file_payload_b64 = Buffer(file_buffer).toString("base64");
         const file_hash = hashDataPayload(file_buffer.toString());

         // make file header blob
         let file_header = makeFileEntry(file_hash, []);
         const file_header_str = jsonStableSerialize(file_header);
         const file_data_id = `${datastore_id}/${file_name}`;
         const file_header_blob = makeDataInfo(file_data_id, file_header_str, device_id);

         // sign header blob
         const file_header_blob_str = jsonStableSerialize(file_header_blob);
         const file_header_sig = signDataPayload(file_header_blob_str, privkey_hex);

         // serialize and sign datastore 
         const datastore_str = JSON.stringify(datastore);
         const datastore_sig = signRawData(datastore_str, privkey_hex);

         return putFileData(datastore_str, datastore_sig, file_name, file_header_blob_str, file_payload_b64, file_header_sig, {'blockchain_id': blockchain_id, 'full_app_name': app_name})
         .then((res) => {
            
            if (res.error || res.errno) {
               console.log(`Failed to store file ${file_name} to datastore ${datastore_id} (owned by ${blockchain_id} in ${app_name})`);
               return res;
            }

            // update root directory entry with new URLs
            const file_urls = res['urls'];
            assert(file_urls, 'No URLs given back');

            file_header = makeFileEntry(file_hash, file_urls);
            const device_root_info = deviceRootInsert(datastore_id, root_uuid, device_root, file_name, file_header, device_id);
            const device_root_blob = device_root_info['device_root_blob'];
            const device_root_version = device_root_info['timestamp'];

            // serialize and sign 
            const device_root_blob_str = jsonStableSerialize(device_root_blob);
            const device_root_blob_sig = signDataPayload(device_root_blob_str, privkey_hex);

            // replicate 
            return putDeviceRoot(datastore_str, datastore_sig, device_root_blob_str, device_root_blob_sig, {'blockchain_id': blockchain_id, 'full_app_name': app_name, 'sync': sync})
            .then((res) => {

               if (res.error || res.errno) {
                  console.log(`Failed to replicate new device root for device ${device_id} in datastore ${datastore_id} (owned by ${blockchain_id} in ${app_name})`);
                  return res;
               }
            
               putDeviceRootVersion(datastore_id, root_uuid, device_id, device_root_version);
               return file_urls;
            });
         });
      });
   });
}


/*
 * Delete a file.
 *
 * @file_name (string) the name of the file to delete
 * 
 * opts:
 * @sync (boolean) whether or not so synchronously update the root directory page (default: false)
 *
 * Returns a Promise that resolves to true on success
 */
export function deleteFile(file_name, opts) {
   const blockchain_id = getSessionBlockchainID();
   const app_name = getSessionAppName();
   const sync = opts.sync || false;

   return datastoreMountOrCreate()
   .then((ds) => {
 
      assert(ds, 'No datastore mounted or created');

      let datastore = ds.datastore;
      let datastore_id = ds.datastore_id;
      let root_uuid = null;

      const device_id = ds.device_id;
      const privkey_hex = ds.privkey_hex;
      const data_pubkeys = ds.app_public_keys;
      const device_ids = datastore['device_ids'];

      assert(privkey_hex, 'No private key for datastore');

      // look up current device root
      return findDeviceRootInfo(device_id, {'blockchain_id': blockchain_id, 'full_app_name': app_name, 'datastore_id': datastore_id, 'data_pubkeys': data_pubkeys})
      .then((root_info) => {

         if (root_info.error) {
            console.log(`Failed to load device root for datastore ${datastore_id}, device ${device_id}`);
            return root_info;
         }

         datastore = root_info['datastore']
         datastore_id = datastoreGetId(datastore['pubkey']);
         root_uuid = datastore['root_uuid'];

         const device_root = root_info['device_root'];

         if (!Object.keys(device_root['files']).includes(file_name)) {
            // doesn't exist 
            return {'error': `No such file: ${file_name}`, 'errno': 'ENOENT'};
         }

         // make tombstones 
         const file_data_id = `${datastore_id}/${file_name}`;
         const file_tombstone = makeDataTombstones([device_id], file_data_id)[0];
         const file_tombstones = makeDataTombstones(device_ids, file_data_id);
         const signed_file_tombstones = signDataTombstones(file_tombstones, privkey_hex);

         // serialize and sign datastore 
         const datastore_str = JSON.stringify(datastore);
         const datastore_sig = signRawData(datastore_str, privkey_hex);
        
         return deleteFileData(datastore_str, datastore_sig, signed_file_tombstones, {'blockchain_id': blockchain_id, 'full_app_name': app_name, 'datastore_id': datastore_id, 'data_pubkeys': data_pubkeys})
         .then((res) => {

            if (res.error || res.errno) {
               console.log(`Failed to delete file '${file_name}': ${res.error}`);
               return res;
            }

            // update device root directory
            const device_root_blob = deviceRootRemove(datastore_id, root_uuid, device_root, file_name, file_tombstone, device_id);

            // serialize and sign 
            const device_root_blob_str = jsonStableSerialize(device_root_blob);
            const device_root_blob_sig = signDataPayload(device_root_blob_str, privkey_hex);

            // replicate 
            return putDeviceRoot(datastore_str, datastore_sig, device_root_blob_str, device_root_blob_sig, {'blockchain_id': blockchain_id, 'full_app_name': app_name, 'sync': sync})
            .then((res) => {

               if (res.error || res.errno) {
                  console.log(`Failed to replicate new device root for device ${device_id} in datastore ${datastore_id} (owned by ${blockchain_id} in ${app_name})`);
                  return res;
               }
            
               return true;
            });
         });
      });
   });
}


/*
 * List all files
 * opts:
 * @blockchainID (string) the owner of the remote datastore
 * @force (string) if true, tolerate stale data
 *
 * Returns a Promise that resolves to the root directory
 * Throws an exception on network or storage errors
 */
export function listFiles(opts) {
   const blockchain_id = opts.blockchainID || getSessionBlockchainID();
   const app_name = getSessionAppName();
   const datastore_id = getSessionDatastoreID();
   const force = opts.force || false;

   return getRoot({'blockchain_id': blockchain_id, 'datastore_id': datastore_id, 'full_app_name': full_app_name, 'force': force});
}


/*
 * Get a file's URL(s) 
 *
 * @file_name (string) the name of the file
 *
 * opts:
 * @blockchainID (string) the owner of the datastore that contains the file
 * @force (string) if true, tolerate stale data
 *
 * Returns a Promise that resolves to the file's URL or URLs
 * Returns {'error': ...} on "recoverable" error (i.e. bad input, file doesn't exist)
 * Throws an exception on network or storage errors
 */
export function getFileURLs(file_name, opts) {
   const blockchain_id = opts.blockchainID || getSessionBlockchainID();
   const app_name = getSessionAppName();
   const datastore_id = getSessionDatastoreID();
   const device_id = getSessionDeviceID();
   const force = opts.force || false;

   return getFileHeader(file_name, device_id, {'blockchain_id': blockchain_id, 'datastore_id': datastore_id, 'full_app_name': app_name, 'force': force})
   .then((res) => {
      
      if (res.error || res.errno) {
         return res;
      }
      
      return res['file_info']['urls']
   });
}

