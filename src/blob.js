'use strict';

import {
   hashRawData
} from './util';

import {
   decodePrivateKey,
   makeFullyQualifiedDataId
} from 'blockstack';

const assert = require('assert');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = EC('secp256k1');
const Ajv = require('ajv');
const BigInteger = require('bigi');
const bitcoinjs = require('bitcoinjs-lib');


/*
 * Hash an inode payload and its length.
 * Specifically hash `${payload.length}:${payload},`
 *
 * @param payload_buffer (String) the payload to hash
 *
 * Return the sha256
 */
export function hashDataPayload( payload_buffer ) {
   const hash = crypto.createHash('sha256');

   // this forces the hash to be computed over the bytestring
   // (important when computing length!) which will make it
   // match with the Python hash verifier
   const payload_str = Buffer.from(payload_buffer);

   hash.update(`${payload_str.length}:`);
   hash.update(payload_str);
   hash.update(',');

   return hash.digest('hex');
}


/*
 * Sign a string of data.
 *
 * @param payload_buffer (Buffer) the buffer to sign
 * @param privkey_hex (String) the hex-encoded ECDSA private key
 * @param hash (String) optional; the hash of the payload.  payload_buffer can be null if hash is given.
 *
 * Return the base64-encoded signature
 */
export function signRawData( payload_buffer, privkey_hex, hash ) {
  
   const privkey = decodePrivateKey(privkey_hex);
   
   if( !hash ) {
       hash = hashRawData(payload_buffer);
   }

   const sig = ec.sign(hash, privkey, {canonical: true});
 
   // use signature encoding compatible with Blockstack
   let r_array = sig.r.toArray();
   let s_array = sig.s.toArray();
   let r_buf = Buffer.from(r_array).toString('hex');
   let s_buf = Buffer.from(s_array).toString('hex');

   if(r_buf.length < 64) {
      while(r_buf.length < 64) {
         r_buf = "0" + r_buf;
      }
   }

   if( s_buf.length < 64) {
      while(s_buf.length < 64) {
         s_buf = "0" + s_buf;
      }
   }

   const sig_buf_hex = r_buf + s_buf;

   assert(sig_buf_hex.length == 128);

   const sigb64 = Buffer.from(sig_buf_hex, 'hex').toString('base64');
   return sigb64;
}


/*
 * Sign a data payload and its length.
 * Specifically sign `${payload.length}:${payload},`
 *
 * @payload_string (String) the string to sign
 * @privkey_hex (String) the hex-encoded private key
 *
 * Return the base64-encoded signature
 */
export function signDataPayload( payload_string, privkey_hex ) {
   return signRawData( Buffer.concat( [Buffer.from(`${payload_string.length}:`), Buffer.from(payload_string), Buffer.from(',')] ), privkey_hex );
}


/*
 * Make a mutable data payload
 * 
 * @param data_id (String) the data identifier (not fully qualified)
 * @param data_payload (String) the data payload to store
 * @param device_id (String) the ID of the device creating this data
 *
 * Returns an mutable data payload object.
 */
export function makeDataInfo( data_id, data_payload, device_id, fq_data_id=null ) {
    if (!fq_data_id) {
        fq_data_id = makeFullyQualifiedDataId( device_id, data_id );
    }

    const timestamp = new Date().getTime();
    
    const ret = {
       'fq_data_id': fq_data_id,
       'data': data_payload,
       'version': 1,
       'timestamp': timestamp,
    };

    return ret
}


/*
 * Make a single datum tombstone.
 *
 * @param tombstone_payload (String) the string that encodes the tombstone
 *
 * Returns the tombstone (to be fed into the storage driver)
 */
export function makeDataTombstone( tombstone_payload ) {
    const now = parseInt(new Date().getTime());
    return `delete-${now}:${tombstone_payload}`;
}


/*
 * Make a list of data tombstones.
 *
 * @param device_ids (Array) the list of device IDs
 * @param data_id (String) the datum ID
 * 
 * Returns a list of tombstones.
 */
export function makeDataTombstones( device_ids, data_id ) {
    const ts = [];
    for (let device_id of device_ids) {
       ts.push( makeDataTombstone( makeFullyQualifiedDataId(device_id, data_id) ));
    }
    return ts;
}


/*
 * Sign a datum tombstone
 *
 * @param tombstone (String) the tombstone string
 * @param privkey (String) the hex-encoded private key
 * 
 * Returns the signed tombstone as a String
 */
export function signDataTombstone( tombstone, privkey ) {
    const sigb64 = signRawData( tombstone, privkey );
    return `${tombstone}:${sigb64}`;
}


/* 
 * Sign a list of mutable data tombstones
 *
 * @param tobmstones (Array) the list of per-device tombstones
 * @param privkey (String) the hex-encoded private key
 *
 * Returns the list of signed tombstones as an Array.
 */
export function signDataTombstones( tombstones, privkey ) {
    const sts = [];
    for (let ts of tombstones) {
       sts.push( signDataTombstone(ts, privkey) );
    };
    return sts;
}


/*
 * Parse a (unsigned) data tombstone
 *
 * @param tombstone (string) the tombstone payload
 *
 * Returns an object with:
 *  .timestamp (int) the timestamp of the tombstone (in milliseconds)
 *  .id (string) the data ID of the tombstone
 *
 * Returns null on failure
 */
export function parseDataTombstone(tombstone) {
    const re = new RegExp(OP_TOMBSTONE_PATTERN);
    const groups = re.exec(tombstone);
    if (!groups) {
       return null;
    }

    const ts = parseInt(groups[1]);
    const data_id = groups[2];

    return {'timestamp': ts, 'id': data_id};
}


/* 
 * Parse a fully-qualified data ID 
 *
 * @param fq_data_id (string) the fully-qualified data ID 
 *
 * Returns an object with:
 *    .device_id: the device identifier
 *    .data_id: the device-specific data ID
 *
 * Returns null on failure to parse
 */
export function parseFullyQualifiedDataId(fq_data_id) {
    fq_data_id = unescape(fq_data_id).replace("\\x2f", "/");
    let parts = fq_data_id.split(":", 2);
    if (parts.length != 2) {
        return null;
    }
    
    return {'device_id': parts[0], 'data_id': parts[1]};
}
