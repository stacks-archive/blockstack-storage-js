'use strict'

import {jsonStableSerialize} from './util';

import {
   URI_RECORD_SCHEMA,
   OP_TOMBSTONE_PATTERN,
   ROOT_DIRECTORY_LEAF,
} from './schemas';

import {
   makeDataInfo,
   makeFullyQualifiedDataId,
} from './blob';


const assert = require('assert');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = EC('secp256k1');
const Ajv = require('ajv');
const BigInteger = require('bigi');
const bitcoinjs = require('bitcoinjs-lib');

const BLOCKSTACK_STORAGE_PROTO_VERSION = 1;


/*
 * Make an empty directory page.
 *
 * @param datastore_id (string) the datastore ID
 * @param reader_pubkeys (array) the list of reader public keys
 * @timestamp (int) the number of milliseconds since the epoch
 *
 * Returns a new device root directory page
 */
export function makeEmptyDeviceRootDirectory(datastore_id, reader_pubkeys, timestamp=null) {
   if (!timestamp) {
      timestamp = new Date().getTime();
   }

   let readers = [];
   for (let reader_pubk of reader_pubkeys) {
      readers.push(publicKeyToAddress(reader_pubk));
   }

   let deviceRootDir = {
      'proto_version': 2,
      'type': ROOT_DIRECTORY_LEAF,
      'owner': datastore_id,
      'readers': readers,
      'timestamp': timestamp,
      'files': {},
      'tombstones': {},
   };

   return deviceRootDir;
}


/*
 * Serialize a device root to a string.
 *
 * @param device_id (string) this device ID
 * @param datastore_id (string) the ID fo this datastore
 * @param root_uuid (string) the ID of the root directory 
 * @param device_root (object) the device-specific root page
 *
 */
export function deviceRootSerialize(device_id, datastore_id, root_uuid, device_root) {
    const data_id = `${datastore_id}.${root_uuid}`;
    const device_root_data_id = makeFullyQualifiedDataId(device_id, data_id);
    const device_root_data = JSON.stringify(device_root);
    const device_root_blob = makeDataInfo(data_id, device_root_data, device_id, device_root_data_id);
    return device_root_blob;
}


/*
 * Insert a file header into the device root
 *
 * @param datastore_id (string) the datastore ID
 * @param root_uuid (string) the UUID of the root
 * @param device_root (object) the device root page
 * @param file_name (string) the name of this file
 * @param file_entry (object) the file header 
 * @param device_id (string) this device ID
 *
 * Returns {'device_root_blob': ..., 'timestamp': ...}
 */
export function deviceRootInsert(datastore_id, root_uuid, device_root, file_name, file_entry, device_id) {
    const now = new Date().getTime();
    const new_timestamp = device_root['timestamp'] + 1 > now ? device_root['timestamp'] + 1 : now;
    
    device_root['timestamp'] = new_timestamp;
    device_root['files'][file_name] = file_entry;

    const new_root = deviceRootSerialize(device_id, datastore_id, root_uuid, device_root);
    return {'device_root_blob': new_root, 'timestamp': new_timestamp};
}


/*
 * Insert a tombstone for a file into a device root
 *
 * @param datastore_id (string) the datastore ID
 * @param root_uuid (string) the UUID of the root
 * @param device_root (object) the device root page
 * @param file_name (string) the name of the file
 * @param file_tombstone (string) the (unsigned) tombstone for this file
 * @param device_id (string) the ID of this device
 *
 * Returns a serialized device root page with teh timestamp advanced and the tombstone inserted
 */
export function deviceRootRemove(datastore_id, root_uuid, device_root, file_name, file_tombstone, device_id) {
    const now = new Date().getTime();
    const new_timestamp = device_root['timestamp'] + 1 > now ? device_root['timestamp'] + 1 : now;

    device_root['timestamp'] = new_timestamp;
    device_root['tombstones'][file_name] = file_tombstone;

    const new_root = deviceRootSerialize(device_id, datastore_id, root_uuid, device_root);
    return new_root;
}


/* 
 * Make an empty file entry
 *
 * @param data_hash (string) the sha256 of the data
 * @param data_urls (array) a list of URLs where this data can be found
 *
 * Returns an object that conforms to ROOT_DIRECTORY_ENTRY_SCHEMA
 */
export function makeFileEntry(data_hash, data_urls) {
    let file_entry = {
       'proto_version': 2,
       'urls': data_urls,
       'data_hash': data_hash,
       'timestamp': new Date().getTime(),
    };

    return file_entry;
}


