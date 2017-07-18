'use strict'

import {jsonStableSerialize} from './util';

import {
   MUTABLE_DATUM_DIR_TYPE,
   MUTABLE_DATUM_FILE_TYPE,
   MUTABLE_DATUM_INODE_HEADER_SCHEMA,
   URI_RECORD_SCHEMA,
   MUTABLE_DATUM_DIR_IDATA_SCHEMA,
} from './schemas';

const assert = require('assert');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = EC('secp256k1');
const Ajv = require('ajv');

const BLOCKSTACK_STORAGE_PROTO_VERSION = 1;

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
 * Hash raw data
 * @param payload_buffer (Buffer) the buffer to hash
 *
 * Return the sha256
 */
export function hashRawData( payload_buffer ) {
   const hash = crypto.createHash('sha256');

   hash.update(payload_buffer);
   
   return hash.digest('hex');
}


/*
 * Decode a hex string into a byte buffer.
 *
 * @param hex (String) a string of hex digits.
 *
 * Returns a buffer with the raw bytes
 */
function decodeHexString( hex ) {
    const bytes = [];
    for(let i=0; i< hex.length-1; i+=2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return Buffer.from(bytes)
}


/*
 * Decode an ECDSA private key into a byte buffer
 * (compatible with Bitcoin's 'compressed' flag quirk)
 *
 * @param privkey_hex (String) a hex-encoded ECDSA private key on secp256k1; optionally ending in '01'
 *
 * Returns a Buffer with the private key data
 */
export function decodePrivateKey( privatekey_hex ) {
   if( privatekey_hex.length === 66 && privatekey_hex.slice(64, 66) === '01' ) {
       // truncate the '01', which is a hint to Bitcoin to expect a compressed public key
       privatekey_hex = privatekey_hex.slice(0, 64);
   }
   return decodeHexString(privatekey_hex);
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
 * Make a fully-qualified data ID (i.e. includes the device ID)
 * equivalent to this in Python: urllib.quote(str('{}:{}'.format(device_id, data_id).replace('/', '\\x2f')))
 * 
 * @param device_id (String) the device ID 
 * @param data_id (String) the device-agnostic part of the data ID
 *
 * Returns the fully-qualified data ID
 */
export function makeFullyQualifiedDataId( device_id, data_id ) {
   return escape(`${device_id}:${data_id}`.replace('/', '\\x2f'));
}


/*
 * Make a mutable data payload
 * 
 * @param data_id (String) the data identifier (not fully qualified)
 * @param data_payload (String) the data payload to store
 * @param version (Int) the version number
 * @param device_id (String) the ID of the device creating this data
 *
 * Returns an mutable data payload object.
 */
export function makeMutableDataInfo( data_id, data_payload, device_id, version ) {
    const fq_data_id = makeFullyQualifiedDataId( device_id, data_id );
    const timestamp = new Date().getTime();
    
    const ret = {
       'fq_data_id': fq_data_id,
       'data': data_payload,
       'version': version,
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
    const now = parseInt(new Date().getTime() / 1000);
    return `delete-${now}:${tombstone_payload}`;
}


/*
 * Make a list of mutable data tombstones.
 *
 * @param device_ids (Array) the list of device IDs
 * @param data_id (String) the datum ID
 * 
 * Returns a list of tombstones.
 */
export function makeMutableDataTombstones( device_ids, data_id ) {
    const ts = [];
    for (let device_id of device_ids) {
       ts.push( makeDataTombstone( makeFullyQualifiedDataId(device_id, data_id) ));
    }
    return ts;
}


/*
 * Make a list of inode tombstones.
 *
 * @param datastore_id (String) the datastore ID
 * @param inode_uuid (String) the inode ID
 * @param device_ids (Array) the list of device IDs
 *
 * Returns a list of tombstones.
 */
export function makeInodeTombstones( datastore_id, inode_uuid, device_ids ) {
    assert(device_ids.length > 0);

    const header_id = `${datastore_id}.${inode_uuid}.hdr`;
    const header_tombstones = makeMutableDataTombstones( device_ids, header_id );

    const idata_id = `${datastore_id}.${inode_uuid}`;
    const idata_tombstones = makeMutableDataTombstones( device_ids, idata_id );

    return header_tombstones.concat(idata_tombstones);
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
export function signMutableDataTombstones( tombstones, privkey ) {
    const sts = [];
    for (let ts of tombstones) {
       sts.push( signDataTombstone(ts, privkey) );
    };
    return sts;
}


/*
 * Make an inode header blob.
 *
 * @param datastore_id (String) the ID of the datastore for this inode
 * @param inode_type (Int) 1 for file, 2 for directory
 * @param owner_id (String) a string that encodes the owner of this inode (i.e. pass datastore_id for now)
 * @param inode_uuid (String) the inode ID
 * @param data_hash (String) the hex-encoded sha256 of the data
 * @param version (Int) the version of this inode.
 * @param device_id (String) the ID of this device
 *
 * Returns an object encoding an inode header.
 */
export function makeInodeHeaderBlob( datastore_id, inode_type, owner_id, inode_uuid, data_hash, device_id, version ) {
   
   const header = {
      'type': inode_type,
      'owner': owner_id,
      'uuid': inode_uuid,
      'readers': [],    // unused for now
      'data_hash': data_hash,
      'version': version,
      'proto_version': BLOCKSTACK_STORAGE_PROTO_VERSION, 
   };

   let valid = null;
   const ajv = new Ajv();
   try {
       valid = ajv.validate(MUTABLE_DATUM_INODE_HEADER_SCHEMA, header);
       assert(valid);
   }
   catch(e) {
       console.log('header: ' + JSON.stringify(header));
       console.log('schema: ' + JSON.stringify(MUTABLE_DATUM_INODE_HEADER_SCHEMA));
       console.log(e.stack);
       throw e;
   }
   
   const inode_data_id = `${datastore_id}.${inode_uuid}.hdr`;
   const inode_data_payload = jsonStableSerialize(header);
   const inode_header_blob = makeMutableDataInfo( inode_data_id, inode_data_payload, device_id, version );
   return jsonStableSerialize(inode_header_blob);
}


/*
 * Make a directory inode header for a particular datastore and owner.
 *
 * @param datastore_id (String) the ID of the datastore for this inode
 * @param owner_id (String) a string that encodes the owner of this directory (i.e. pass datastore_id for now)
 * @param inode_uuid (String) the ID of the inode
 * @param dir_listing (Object) a MUTABLE_DATUM_DIR_IDATA_SCHEMA-conformant object that describes the directory listing.
 * @param device_id (String) this device ID
 *
 * Returns an object encoding a directory's header and idata
 */
export function makeDirInodeBlob( datastore_id, owner_id, inode_uuid, dir_listing, device_id, version ) {
   
   const ajv = new Ajv();
   let valid = null;
   try {
      valid = ajv.validate(MUTABLE_DATUM_DIR_IDATA_SCHEMA.properties.children, dir_listing);
      assert(valid);
   }
   catch(e) {
      console.log('dir listing: ' + JSON.stringify(dir_listing));
      console.log('schema:      ' + JSON.stringify(MUTABLE_DATUM_DIR_IDATA_SCHEMA));
      throw e;
   }

   if(!version) {
      version = 1;
   }

   const empty_hash = '0000000000000000000000000000000000000000000000000000000000000000';
   const internal_header_blob = makeInodeHeaderBlob( datastore_id, MUTABLE_DATUM_DIR_TYPE, owner_id, inode_uuid, empty_hash, device_id, version );
    
   // recover header 
   const internal_header = JSON.parse( JSON.parse(internal_header_blob).data );
   const idata_payload = {
      children: dir_listing,
      header: internal_header,
   };

   const idata_payload_str = jsonStableSerialize(idata_payload);
   const idata_hash = hashDataPayload(idata_payload_str);

   const header_blob = makeInodeHeaderBlob( datastore_id, MUTABLE_DATUM_DIR_TYPE, owner_id, inode_uuid, idata_hash, device_id, version );
   return {'header': header_blob, 'idata': idata_payload_str};
}


/*
 * Make a file inode header for a particular datastore and owner.
 *
 * @param datastore_id (String) the ID of the datastore for this niode
 * @param owner_id (String) a string that encodes the owner of this file (i.e. pass datastore_id for now)
 * @param inode_uuid (String) the ID of the inode
 * @param data_hash (String) the hash of the file data
 * @param device_id (String) this device ID
 *
 * Returns an object encoding a file's header
 */
export function makeFileInodeBlob( datastore_id, owner_id, inode_uuid, data_hash, device_id, version ) {
   
   const header_blob = makeInodeHeaderBlob( datastore_id, MUTABLE_DATUM_FILE_TYPE, owner_id, inode_uuid, data_hash, device_id, version );
   return {'header': header_blob}
}


/*
 * Get the child inode version from a directory
 * @param parent_dir (Object) directory inode
 * @param child_name (String) name of the directory
 *
 * Raises if there is no child
 */
export function getChildVersion(parent_dir, child_name) {
   assert(parent_dir['idata']['children'][child_name]);
   return parent_dir['idata']['children'][child_name].version;
}


/*
 * Insert an entry into a directory's listing.
 *
 * @param parent_dir (Object) a directory inode structure
 * @param child_type (Int) 1 for file, 2 for directory
 * @param child_name (String) the name of the child inode (must be unique in this directory)
 * @param child_uuid (String) the ID of the child inode.
 * @param exists (Bool) if given, and if True, then expect the child to exist.
 *
 * Returns the new parent directory inode object.
 */
export function inodeDirLink( parent_dir, child_type, child_name, child_uuid, exists ) {
   
   assert(parent_dir['type'] === MUTABLE_DATUM_DIR_TYPE);
   assert(parent_dir['idata']);
   assert(parent_dir['idata']['children']);

   if( !exists ) {
       assert(!Object.keys(parent_dir['idata']['children']).includes(child_name));
   }

   const new_dirent = {
      uuid: child_uuid,
      type: child_type,
      version: 1,
   };

   if(parent_dir['idata']['children']['version']) {
      new_dirent.version = parent_dir['idata']['children']['version'] + 1;
   }

   parent_dir['idata']['children'][child_name] = new_dirent;
   parent_dir['version'] += 1;
   return parent_dir;
}


/*
 * Detach an inode from a directory.
 *
 * @param parent_dir (Object) a directory inode structure
 * @param child_name (String) the name of the child to detach
 *
 * Returns the new parent directory inode object.
 */
export function inodeDirUnlink( parent_dir, child_name ) {

   assert(parent_dir['type'] === MUTABLE_DATUM_DIR_TYPE);
   assert(parent_dir['idata']);
   assert(parent_dir['idata']['children']);

   assert(Object.keys(parent_dir['idata']['children']).includes(child_name));

   delete parent_dir['idata']['children'][child_name];
   parent_dir['version'] += 1;
   return parent_dir;
}

