'use strict';

import inspector from 'schema-inspector';
import {
   DATASTORE_SCHEMA,
   MUTABLE_DATUM_INODE_SCHEMA,
   MUTABLE_DATUM_DIR_IDATA_SCHEMA,
   MUTABLE_DATUM_EXTENDED_RESPONS_SCHEMA,
   SUCCESS_FAIL_SCHEMA,
   DATASTORE_LOOKUP_RESPONSE_SCHEMA,
   DATASTORE_LOOKUP_EXTENDED_RESPONSE_SCHEMA
} from './schemas';

import {
   make_file_inode_blob,
   make_dir_inode_blob,
   sign_data_payload,
   hash_data_payload,
   inode_dir_link,
   inode_dir_unlink,
   decode_privkey,
   make_inode_tombstones,
   make_mutable_data_tombstones,
   sign_mutable_data_tombstones,
   get_child_version,
} from './inode';

const http = require('http');
const uuid4 = require('uuid/v4');
const bitcoinjs = require('bitcoinjs-lib');
const BigInteger = require('bigi');
const Promise = require('promise');

const ENOENT = 2;
const EEXIST = 17;
const ENOTDIR = 20;

// datastore response includes the ID
const DATASTORE_RESPONSE_SCHEMA = JSON.parse(JSON.stringify(DATASTORE_SCHEMA));
DATASTORE_RESPONSE_SCHEMA['properties']['datastore_id'] = {'type': 'string'};

/*
 * Helper method to issue an HTTP request.
 * @param options (Object) set of HTTP request options
 * @param result_schema (Object) JSON schema of the expected result 
 */
function http_request(options, result_schema) {

   var p = new Promise(function(resolve, reject) {
      http.request(options, function(response) {    
         var strbuf = [];
         response.on('data', function(chunk) {
            strbuf.push(chunk);
         });

         response.on('end', function() {
            var str = Buffer.concat(strbuf).toString();
            var resp = JSON.parse(str);

            // avoid memory leaks
            str = null;
            strbuf = null;

            if( result_schema ) {
               try {
                  inspector.validate(result_schema, resp);
               }
               catch(e) {
                  try {
                     inspector.validate(E
                  reject(e.message);
               }
            }
             
            resolve(resp);
         });

         response.on('error', function(e) {
            reject(e.message);
         });
      }).end();
   });
   return p;
}

function http_request(options, result_schema, continuation) {
   var cb = function(response) {    
      
      var str = '';
      response.on('data', function(chunk) {
         str += chunk;
      })

      response.on('end', function() {
         var resp = JSON.parse(str);
         
         if( result_schema ) {
             inspector.validate(result_schema, resp);
         }

         if( !continuation ) {
             continuation = function(r) {
                return r;
             };
         }

         return continuation(resp);
      })
   }

   return http.request(options, cb);
}


/*
 * Convert a datastore public key to its ID.
 * @param ds_public_key (String) hex-encoded ECDSA public key
 */
export function datastore_get_id( ds_public_key_hex ) {
    var ec = bitcoinjs.ECPair.fromPublicKeyBuffer( Buffer.from(ds_public_key_hex, 'hex') );
    return ec.getAddress();
}


/*
 * Sanitize a path.  Consolidate // to /, and resolve foo/../bar to bar
 * @param path (String) the path
 *
 * Returns the sanitized path.
 */
export function sanitize_path( path ) {
   
    var parts = path.split('/').filter(function(x) {return x.length > 0;});
    var retparts = [];

    for(var i = 0; i < parts.length; i++) {
       if(parts[i] == '..') {
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
   return path.split('/').slice(-1);
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
function split_hostport(hostport) {

   var host = hostport;
   var port = 80;
   var parts = hostport.split(':');
   if( parts.length > 1 ) {
      host = parts[0];
      port = parts[1];
   }

   return {'host': host, 'port': port};
}


/*
 * Create the signed request to create a datastore.
 * This information can be fed into datastore_create()
 * Returns an object with:
 *      .datastore_info: datastore information
 *      .datastore_sigs: signatures over the above.
 */
export function datastore_create_mkinfo( ds_type, ds_private_key_hex, drivers, device_id, all_device_ids ) {

   assert(ds_type == 'datastore' || ds_type == 'collection');
   var root_uuid = uuid4();
    
   var ds_privkey = BigInteger.fromBuffer( decode_privkey(ds_private_key_hex) );
   var ds_public_key = bitcoinjs.ECPair(ds_privkey).getPublicKeyBuffer().toString('hex');
   var datastore_id = datastore_get_id( ds_public_key );
   var root_blob = make_dir_inode_blob( datastore_id, datastore_id, root_uuid, {}, 1, device_id )

   // actual datastore payload
   var datastore_info = {
      'type': ds_type,
      'pubkey': ds_public_key,
      'drivers': drivers,
      'device_ids': all_device_ids,
      'root_uuid': root_uuid,
   };

   var data_id = `${datastore_id}.datastore`;
   var datastore_blob = make_mutable_data_blob( data_id, json_stable_serialize(datastore_info), 1, device_id );

   // sign them all
   var root_sig = sign_data_payload( root_blob, ds_private_key_hex );
   var datastore_sig = sign_data_payload( datastore_blob, ds_private_key_hex );

   // make and sign tombstones for the root
   var root_tombstones = make_inode_tombstones(datastore_id, root_uuid, all_device_ids);
   var signed_tombstones = sign_mutable_data_tombstones(root_tombstones, ds_private_key_hex);

   var info = {
      'datastore_info': {
         'datastore_id': datastore_id,
         'datastore_blob': datastore_blob, 
         'root_blob': root_blob
      },
      'datastore_sigs': {
         'datastore_sig': datastore_sig, 
         'root_sig': root_sig, 
         'root_tombstones': signed_tombstones
      }
   };

   return info;
}


/*
 * Create a datastore
 * Asynchronous; call .end() on the returned object.
 *
 * Returns an async object whose .end() method returns a datastore object.
 * The returned object has the following properties:
 *      
 */
export function datastore_create( blockstack_hostport, blockstack_session_token, datastore_request, datastore_sigs ) {
    
   var payload = {
      'datastore_info': {
          'datastore_blob': datastore_request.datastore_info.datastore_blob,
          'root_blob': datastore_request.datastore_info.root_blob,
      },
      'datastore_sigs': {
          'datastore_sig': datastore_request.datastore_sigs.datastore_sig,
          'root_sig': datastore_request.datastore_sigs.root_sig,
      },
   };

   hostinfo = split_hostport(blockstack_hostport);

   var options = {
      'method': 'POST',
      'host': hostinfo.host,
      'port': hostinfo.port,
      'path': '/v1/stores'
   };

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   } 

   var body = JSON.stringify(payload);
   options['headers']['Content-Type'] = 'application/json';
   options['headers']['Content-Length'] = body.length;

   var req = http_request(options);
   req.write(body);

   return req;
}


/*
 * Generate the data needed to delete a datastore.
 *
 * @param ds (Object) a datastore context
 * @param privkey (String) the hex-encoded datastore private key
 *
 * Returns an object to be given to datastore_delete()
 */
export function datastore_delete_mkinfo( ds ) {
   var datastore_id = ds.datastore.datastore_id;
   var device_ids = ds.datastore.device_ids;
   var root_uuid = ds.datastore.root_uuid;
   var data_id = `${datastore_id}.datastore`;

   var tombstones = make_mutable_data_tombstones( device_ids, data_id );

   var signed_tombstones = sign_mutable_data_tombstones( tombstones, ds.privkey_hex );
   var root_tombstones = make_inode_tombstones(datastore_id, root_uuid, all_device_ids);

   var ret = {
      'datastore_tombstones': signed_tombstones,
      'root_tombstones': root_tombstones,
   };

   return ret;
}

/*
 * Delete a datastore
 *
 * @param ds (Object) a datastore context
 * @param ds_tombstones (Object) signed information from datastore_delete_mkinfo()
 *
 * Asynchronous; call .end() on the returned object.
 */
export function datastore_delete( ds, ds_tombstones, root_tombstones ) {
    
   var payload = {
      'datastore_tombstones': ds_tombstones,
      'root_tombstones': root_tombstones,
   };

   var options = {
      'method': 'DELETE',
      'host': ds.host,
      'port': ds.port,
      'path': '/v1/stores'
   };

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   } 

   var body = JSON.stringify(payload);
   options['headers']['Content-Type'] = 'application/json';
   options['headers']['Content-Length'] = body.length;

   var req = http_request(options);
   req.write(body);
   return req;
}


/*
 * Look up a datastore and establish enough contextual information to do subsequent storage operations.
 * Asynchronous; call .end() on the returned object.
 *
 * Returns an async object whose .end() method returns a datastore connection,
 * with the following properties:
 *      .host: blockstack host
 *      .datastore: datastore object
 */
export function datastore_connect( blockstack_hostport, blockstack_session_token, datastore_id, data_privkey_hex, device_id ) {

   var hostinfo = split_hostport(blockstack_hostport);

   var ctx = {
      'host': hostinfo.host,
      'port': hostinfo.port,
      'session_token': blockstack_session_token,
      'device_id': device_id,
      'privkey_hex': data_privkey_hex,
      'datastore': null,
   };

   var options = {
      'method': 'GET',
      'host': hostinfo.host,
      'port': hostinfo.port,
      'path': `/v1/stores/${datastore_id}`,
   }

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${blockstack_session_token}`};
   }

   return http_request(options, DATASTORE_RESPONSE_SCHEMA, function(ds) { ctx['datastore'] = ds; return ctx });
}


/*
 * Path lookup 
 * 
 * @param ds (Object) a datastore context
 * @param path (String) the path to the inode
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode information
 *      .force (Bool) if True, then ignore stale inode errors.
 *      .idata (Bool) if True, then get the inode payload as well
 *
 * Asynchronos; call .end() on the returned object.
 */
export function lookup(ds, path, opts) {

   var datastore_id = ds['datastore']['datastore_id'];
   var options = {
      'method': 'GET',
      'host': ds.host,
      'port': ds.port,
      'path': `/v1/stores/${datastore_id}/inodes?path=${escape(sanitize_path(path))}`,
   };

   if(!opts) {
      opts = {};
   }

   var schema = DATASTORE_LOOKUP_RESPONSE_SCHEMA;

   if( opts.extended ) {
      options['path'] += '&extended=1';
      schema = DATASTORE_LOOKUP_EXTENDED_RESPONSE_SCHEMA;
   }

   if( opts.force ) {
      options['path'] += '&force=1';
   }

   if( opts.idata ) {
      options['idata'] += '&idata=1';
   }


   return http_request(options, schema);
}
    

/*
 * List a directory.
 *
 * @param ds (Object) a datastore context
 * @param path (String) the path to the directory to list
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *
 * Asynchronous; call .end() on the returned object.
 */
export function listdir(ds, path, opts) {

   var datastore_id = ds['datastore']['datastore_id'];
   var options = {
      'method': 'GET',
      'host': ds.host,
      'port': ds.port,
      'path': `/v1/stores/${datastore_id}/directories?path=${escape(sanitize_path(path))}&idata=1`,
   };

   var schema = MUTABLE_DATUM_DIR_IDATA_SCHEMA;

   if(!opts) {
      opts = {};
   }

   if( opts.extended ) {
      options['path'] += '&extended=1';
      schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
   }

   if( opts.force ) {
      optsion['path'] += '&force=1';
   }

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   }

   return http_request(options, schema);
}


/* 
 * Stat a file or directory (i.e. get the inode header)
 *
 * @param ds (Object) a datastore context
 * @param path (String) the path to the directory to list
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *
 * Asynchronous; call .end() on the returned object.
 */
export function stat(ds, path, opts) {

   var datastore_id = ds.datastore.datastore_id;
   var options = {
      'method': 'GET',
      'host': ds.host,
      'port': ds.port,
      'path': `/v1/stores/${datastore_id}/inodes?path=${escape(sanitize_path(path))}`,
   };

   var schema = MUTABLE_DATUM_INODE_SCHEMA;

   if(!opts) {
      opts = {};
   }

   if( opts.extended ) {
      options['path'] += '&extended=1';
      schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
   }
   
   if( opts.force ) {
      optsion['path'] += '&force=1';
   }

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   } 

   return http_request(options, schema);
}


/* 
 * Get an undifferentiated file or directory and its data.
 * Low-level method, not meant for external consumption.
 *
 * @param ds (Object) a datastore context
 * @param path (String) the path to the directory to list
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 * @param continuation (functino) optional continuation function
 *
 * Asynchronous; call .end() on the returned object.
 */
function getinode(ds, path, opts, continuation) {

   var datastore_id = ds.datastore.datastore_id;
   var options = {
      'method': 'GET',
      'host': ds.host,
      'port': ds.port,
      'path': `/v1/stores/${datastore_id}/inodes?path=${escape(sanitize_path(path))}&idata=1`,
   };

   var schema = MUTABLE_DATUM_INODE_SCHEMA;

   if(!opts) {
      opts = {};
   }

   if( opts.extended ) {
      options['path'] += '&extended=1';
      schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
   }
   
   if( opts.force ) {
      optsion['path'] += '&force=1';
   }

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   } 

   return http_request(options, schema, continuation);
}


/*
 * Get a file.
 *
 * @param ds (Object) a datastore context
 * @param path (String) the path to the file to read
 * @param opts (Object) optional arguments:
 *      .extended (Bool) whether or not to include the entire path's inode inforamtion
 *      .force (Bool) if True, then ignore stale inode errors.
 *
 * Asynchronous; call .end() on the returned object.
 */
export function getfile(ds, path, opts) {

   var datastore_id = ds.datastore.datastore_id;
   var options = {
      'method': 'GET',
      'host': ds.host,
      'port': ds.port,
      'path': `/v1/stores/${datastore_id}/files?path=${escape(sanitize_path(path))}&idata=1`,
   };

   var schema = null;

   if(!opts) {
      opts = {};
   }

   if( opts.extended ) {
      options['path'] += '&extended=1';
      schema = MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA;
   }

   if( opts.force ) {
      optsion['path'] += '&force=1';
   }

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   }

   return http_request(options, schema);
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
 * Asynchronous; return .end() on the return object.
 */
function datastore_operation(ds, operation, path, inodes, payloads, signatures, tombstones) {

   var request_path = null;
   var http_operation = null;
   var datastore_id = ds.datastore.datastore_id;

   assert(inode.length == payloads.length);
   assert(payloads.length == signatures.length);

   if( operation == 'mkdir' ) {
      request_path = `/v1/stores/${datastore_id}/directories?path=${escape(sanitize_path(path))}`;
      http_operation = 'POST';

      assert(inodes.length == 2);
   }
   else if( operation == 'putfile' ) {
      request_path = `/v1/stores/${datastore_id}/files?path=${escape(sanitize_path(path))}`;
      http_operation = 'PUT';

      assert(inodes.length == 1 || inodes.length == 2);
   }
   else if( operation == 'rmdir' ) {
      request_path = `/v1/stores/${datastore_id}/directories?path=${escape(sanitize_path(path))}`;
      http_operation = 'DELETE';

      assert(inodes.length == 1);
      assert(tombstones.length == 1);
   }
   else if( operation == 'unlink' ) {
      request_path = `/v1/stores/${datastore_id}/files?path=${escape(sanitize_path(path))}`;
      http_operation = 'DELETE';

      assert(inodes.length == 0);
      assert(tombstones.length == 1);
   }
   else {
      assert(0);
   }

   var options = {
      'method': http_operation,
      'host': ds.host,
      'port': ds.port,
      'path': request_path
   };

   if( blockstack_session_token ) {
      options['headers'] = {'Authorization': `bearer ${ds.session_token}`};
   }

   return http_request(options, SUCCESS_FAIL_SCHEMA);
}


/*
 * Given a path, get its parent directory
 * Make sure it's a directory.
 *
 * @param ds (Object) a datastore context
 * @param path (String) the path to the inode in question
 * @param opts (Object) lookup options
 *
 * Asynchronous; call .end() on the returned object.
 */
export function get_parent(ds, path, opts, continuation) {
   var dirpath = dirname(path);
   var parent_dir = getinode(ds, path, opts, function(resp) {
      var inode = resp.inode_info.inode;
      if(inode.type != MUTABLE_DATUM_DIR_TYPE) {
         return {'error': 'Not a directory', 'errno': ENOTDIR}
      }

      if( !continuation ) {
         continuation = function(inode) {
            return inode;
         }
      }

      return continuation(inode);
   })

   return parent_dir;
}


/*
 * Create or update a file
 *
 * @param ds (Object) a datastore context
 * @param path (String) the path to the file to create (must not exist)
 * @param file_buffer (Buffer) the file contents
 *
 * Asynchronous; call .end() on the returned object.
 */
export function putfile(ds, path, file_buffer, parent_dir, continuation) {

   var datastore_id = ds.datastore.datastore_id;
   var device_id = ds.device_id;
   var privkey_hex = ds.privkey_hex;

   path = sanitize_path(path);
   var child_name = basename(path);

   // get parent dir 
   if( !parent_dir ) {
       parent_dir = get_parent(ds, path).end();
       if( parent_dir.error ) {
          return parent_dir;
       }
   }

   // make the file inode information
   var file_hash = hash_data_payload( file_buffer );
   var file_payload = file_buffer.toString('base64');
   var inode_uuid = null;
   var new_parent_dir_inode = null;
   var child_version = null;

   // new or existing?
   if( Object.keys(parent_dir['idata']).includes(child_name) ) {

      // existing; no directory change
      inode_uuid = parent_dir['idata'][child_name]['uuid'];
      new_parent_dir_inode = inode_dir_link(parent_dir, MUTABLE_DATUM_TYPE_FILE, child_name, inode_uuid, true );
   }
   else {

      // new 
      inode_uuid = uuid4();
      new_parent_dir_inode = inode_dir_link(parent_dir, MUTABLE_DATUM_FILE_TYPE, child_name, inode_uuid, false );
   }

   var version = get_child_version(parent_dir, child_name);
   var inode_info = make_file_inode_info( datastore_id, datastore_id, inode_uuid, file_hash, version, device_id );
   var inode_sig = sign_data_payload( inode_info['header'], privkey_hex, file_hash );

   // make the directory inode information
   var new_parent_info = make_dir_inode_info( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata'], new_parent_dir_inode['version'] + 1, device_id );
   var new_parent_sig = sign_data_payload( new_parent_info['header'], privkey_hex );

   // post them 
   return datastore_operation(ds, 'putfile', path, [inode_info['header'], new_parent_blob['header']], [file_payload, new_parent_info['idata']], [inode_sig, new_parent_sig], []);
}


/*
 * Create a directory.
 *
 * @param ds (Object) datastore context
 * @param path (String) path to the directory
 * @param parent_dir (Object) (optional) parent directory inode
 *
 * Asynchronous; call .end() on the returned object.
 */
export function mkdir(ds, path, parent_dir) {

   var datastore_id = ds.datastore.datastore_id;
   var device_id = ds.device_id;
   var privkey_hex = ds.privkey_hex;

   path = sanitize_path(path);
   var child_name = basename(path);

   if(!parent_dir) {
      parent_dir = get_parent(ds, path).end();
      if( parent_dir.error ) {
         return parent_dir;
      }
   }

   // must not exist 
   if( Object.keys(parent_dir['idata']).includes(child_name) ) {
      return {'error': 'File or directory exists', 'errno': EEXIST};
   }

   // make the directory inode information 
   var inode_uuid = uuid4();
   var inode_info = make_dir_inode_info( datastore_id, datastore_id, inode_uuid, {}, 1, device_id);
   var inode_sig = sign_data_payload( inode_info['header'], privkey_hex );

   // make the new parent directory information 
   var new_parent_dir_inode = inode_dir_link(parent_dir, MUTABLE_DATUM_DIR_TYPE, child_name, inode_uuid);
   var new_parent_info = make_dir_inode_info( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata'], new_parent_dir_inode['version'] + 1, device_id );
   var new_parent_sig = sign_data_payload( new_parent_info['header'], privkey_hex );

   // post them 
   return datastore_operation(ds, 'mkdir', path, [inode_info['header'], new_parent_blob['header']], [inode_info['idata'], new_parent_info['idata']], [inode_sig, new_parent_sig], []);
}


/*
 * Delete a file 
 *
 * @param ds (Object) datastore context
 * @param path (String) path to the directory
 * @param parent_dir (Object) (optional) parent directory inode
 *
 * Asynchronous; call .end() on the returned object
 */
export function unlink(ds, path, parent_dir) {

   var datastore_id = ds.datastore.datastore_id;
   var device_id = ds.device_id;
   var all_device_ids = ds.device_ids;
   var privkey_hex = ds.privkey_hex;

   path = sanitize_path(path);
   var child_name = basename(path);

   if(!parent_dir) {
      parent_dir = get_parent(ds, path).end();
      if( parent_dir.error ) {
         return parent_dir;
      }
   }

   // no longer exists?
   if( !Object.keys(parent_dir['idata']).includes(child_name) ) {
      return {'error': 'No such file or directory', 'errno': ENOENT};
   }

   var inode_uuid = parent_dir['idata'][child_name];

   // unlink 
   var new_parent_dir_inode = inode_dir_unlink(parent_dir, name);
   var new_parent_info = make_dir_inode_info( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata'], new_parent_dir_inode['version'] + 1, device_id );
   var new_parent_sig = sign_data_payload( new_parent_info['header'], privkey_hex );

   // make tombstones 
   var tombstones = make_inode_tombstones(datastore_id, inode_uuid, all_device_ids);
   var signed_tombstones = sign_mutable_data_tombstones(tombstones, privkey_hex);
   
   // post them 
   return datastore_operation(ds, 'unlink', path, [new_parent_blob['header']], [new_parent_info['idata']], [new_parent_sig], signed_tombstones);
}


/*
 * Remove a directory 
 *
 * @param ds (Object) datastore context
 * @param path (String) path to the directory
 * @param parent_dir (Object) (optional) parent directory inode
 *
 * Asynchronous; call .end() on the returned object 
 */
export function rmdir(ds, path, parent_dir) {

   var datastore_id = ds.datastore.datastore_id;
   var device_id = ds.device_id;
   var all_device_ids = ds.device_ids;
   var privkey_hex = ds.privkey_hex;

   path = sanitize_path(path);
   var child_name = basename(path);

   if(!parent_dir) {
      parent_dir = get_parent(ds, path).end();
      if( parent_dir.error ) {
         return parent_dir;
      }
   }

   // no longer exists?
   if( !Object.keys(parent_dir['idata']).includes(child_name) ) {
      return {'error': 'No such file or directory', 'errno': ENOENT};
   }

   var inode_uuid = parent_dir['idata'][child_name];

   // unlink 
   var new_parent_dir_inode = inode_dir_unlink(parent_dir, name);
   var new_parent_info = make_dir_inode_blob( datastore_id, new_parent_dir_inode['owner'], new_parent_dir_inode['uuid'], new_parent_dir_inode['idata'], new_parent_dir_inode['version'] + 1, device_id );
   var new_parent_sig = sign_data_payload( new_parent_info['header'], privkey_hex );

   // make tombstones 
   var tombstones = make_inode_tombstones(datastore_id, inode_uuid, all_device_ids);
   var signed_tombstones = sign_mutable_data_tombstones(tombstones, privkey_hex);

   // post them 
   return datastore_operation(ds, 'rmdir', path, [new_parent_blob['header']], [new_parent_info['idata']], [new_parent_sig], signed_tombstones);
}


