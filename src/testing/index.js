'use strict'

import { 
   create_datastore,
   delete_datastore,
   get_datastore,
   datastore_mkdir,
   datastore_rmdir,
   datastore_listdir,
   datastore_getfile,
   datastore_putfile,
   datastore_deletefile,
   datastore_stat
} from './integration_tests';

import {
   datastore_get_id
} from '../datastore';

import {
   decode_privkey
} from '../inode';

const assert = require('assert');
const bitcoinjs = require('bitcoinjs-lib');
const http = require('http');
const jsontokens = require('jsontokens');
const BigInteger = require('bigi');

var args = process.argv.slice(2);
assert(args.length > 0);

var command = args[0];
var res = null;

function dir_expect(dir, names) {
   for (var name of names) {
      if( !Object.keys(dir).includes(name) ) {
         return false;
      }
   }
   return true;
}

function stat_dirs(ds_str, dir_list, expect_error) {
   for (var dir_path of dir_list) {
      var res = datastore_stat(ds_str, dir_path);
      if( res.error || !res.inode ) {
         if( expect_error ) {
            continue;
         }
         else {
            console.log(res.error);
            return false;
         }
      }

      if( res.inode.type != 2 ) {
         console.log(res.error);
         return false;
      }
   }
   return true;
}

function stat_files(ds_str, file_list, expect_error) {
   for (var file_path of file_list) {
      var res = datastore_stat(ds_str, file_path);
      if( res.error || !res.inode ) {
         if( expect_error ) {
            continue;
         }
         else {
            console.log(res.error);
            return false;
         }
      }

      if( res.inode.type != 1 ) {
         console.log(res.error);
         return false;
      }
   }
   return true;
}

function files_expect(ds_str, paths, contents) {
   assert(paths.length == contents.length);
   for( var i = 0; i < paths.length; i++ ) {
      var file_path = paths[i];
      var content = contents[i];
      var res = datastore_getfile(ds_str, path);
      if( res.error ) {
         console.log(res.error);
         return false;
      }

      if( res != content ) {
         console.log(`expected ${content}; got ${res}`);
         return false;
      }
   }
   return true;
}


function http_request(options, result_schema, continuation) {
   var cb = function(response) {    
   
      var str = '';
      response.on('data', function(chunk) {
         str += chunk;
      });

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
        
         console.log(resp);
         return continuation(resp);
      });
   }
 
   console.log(options)
   return http.request(options, cb);
}


function get_session_token(host, port, ds_private_key_hex, api_password) {
   var ds_privkey = BigInteger.fromHex(ds_private_key_hex);
   var ds_public_key = new bitcoinjs.ECPair(ds_privkey).getPublicKeyBuffer().toString('hex');

   var auth_request = {
      'app_domain': 'blockstack-storage-test-js',
      'methods': ['store_read', 'store_write', 'store_admin'],
      'app_public_key': ds_public_key,
   };

   var ts = new jsontokens.TokenSigner('ES256k', ds_private_key_hex);
   var signed_auth_request = ts.sign(auth_request);

   var options = {
      'method': 'GET',
      'host': host,
      'port': port,
      'path': `/v1/auth?authRequest=${signed_auth_request}`,
      'headers': {
         'Authorization': `basic ${api_password}`
      }
   };

   var req = http_request(options);
   var resp = req.end();
   return resp['token'];
}

function node_ping(host, port) {
   var options = {
      'method': 'GET',
      'host': host,
      'port': port,
      'path': '/v1/node/ping',
   };

   var req = http_request(options);
   var resp = req.end();
   return resp;
}


if( command == 'create_datastore' ) { 
   assert(args.length >= 5);
   res = create_datastore(args[1], args[2], args[3], args[4], args[5])
}
else if( command == 'delete_datastore') {
   assert(args.length >= 2);
   res = delete_datastore(args[1]);
}
else if( command == 'get_datastore') {
   assert(args.length >= 5);
   res = get_datastore(args[1], args[2], args[3], args[4]);
}
else if( command == 'mkdir' ) {
   assert(args.length >= 3);
   res = datastore_mkdir(args[1], args[2], args[3], args[4]);
}
else if( command == 'rmdir' ) {
   assert(args.length >= 3);
   res = datastore_rmdir(args[1], args[2], args[3], args[4]);
}
else if( command == 'listdir' ) {
   assert(args.length >= 3 );
   res = datastore_listdir(args[1], args[2], args[3], args[4]);
}
else if( command == 'getfile' ) {
   assert(args.length >= 3);
   res = datastore_getfile(args[1], args[2], args[3], args[4]);
}
else if( command == 'putfile' ) {
   assert(args.length >= 4);
   res = datastore_putfile(args[1], args[2], args[3], args[4], args[5]);
}
else if( command == 'deletefile' ) {
   assert(args.length >= 3);
   res = datastore_deletefile(args[1], args[2]);
}
else if( command == 'stat' ) {
   assert(args.length >= 3 );
   res = datastore_stat(args[1], args[2]);
}
else if( command == 'unittest' ) {
   assert(args.length >= 2);
   var api_password = args[1];
   var device_id = 'c429b777-c7b9-4e07-99ba-7cdf98a283c3';
   var datastore_privkey = bitcoinjs.ECPair.makeRandom();
   var datastore_privkey_hex = datastore_privkey.d.toBuffer().toString('hex');
   var datastore_pubkey_hex = datastore_privkey.getPublicKeyBuffer().toString('hex');
   var datastore_id = datastore_get_id(datastore_pubkey_hex);
   var res = null;
   var datastore = null;
   var datastore_str = null;
   var session_token = null;
  
   console.log(`private key is ${datastore_privkey_hex}`);

   console.log("begin ping");
   res = node_ping('localhost', 6270);
   console.log(`ping result: ${res}`);

   session_token = get_session_token('localhost', 6270, datastore_privkey_hex, api_password);
   if( !session_token ) {
      console.log("failed to authenticate");
      process.exit(1);
   }
   
   res = create_datastore(datastore_privkey_hex, session_token, device_id, [device_id], ['disk']);
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   res = get_datastore(session_token, datastore_id, datastore_privkey_hex, device_id);
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   datastore = res.datastore;
   datastore_str = JSON.stringify(datastore);

   res = datastore_mkdir(datastore_str, '/dir1');
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   res = datastore_mkdir(datastore_str, '/dir1/dir2');
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   res = datastore_putfile(datastore_str, '/file1', "hello world");
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   res = datastore_putfile(datasore_str, '/dir1/file2', "hello world 2");
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   res = datastore_putfile(datastore_str, '/dir1/dir2/file3', 'hello world 3');
   if( res.error ) {
      console.log(res);
      process.exit(1);
   }

   res = datastore_listdir(datastore_str, '/');
   if( res.error || !res.dir ) {
      console.log(res);
      process.exit(1);
   }

   if( !dir_expect(res.dir, ['dir1', 'file1']) ) {
      console.log(res);
      process.exit(1);
   }

   res = datastore_listdir(datastore_str, '/dir1');
   if( res.error || !res.dir ) {
      console.log(res);
      process.exit(1);
   }

   if( !dir_expect(res.dir, ['dir2', 'file2']) ) {
      console.log(res);
      process.exit(1);
   }

   if( !stat_dirs(ds_str, ['/', '/dir1', '/dir1/dir2']) ) {
      process.exit(1);
   }

   if( !stat_files(ds_str, ['/file1', '/dir1/file2', '/dir1/dir2/file3']) ) {
      process.exit(1);
   }

   if( !files_expect(ds_str, ['/file1', '/dir1/file2', '/dir1/dir2/file3'], ['hello world', 'hello world 2', 'hello world 3']) ) {
      process.exit(1);
   }

   for (var file_path in ['/file1', '/dir1/file2', '/dir1/dir2/file3']) {
      res = datastore_deletefile(ds_str, file_path);
      if( res.error ) {
         console.log(res);
         process.exit(1);
      }
   }

   if( !stat_files(ds_str, ['/file1', '/dir1/file2', '/dir1/dir2/file3'], true) ) {
      process.exit(1);
   }

   for (var dir_path in ['/dir1/dir2', '/dir1'] ) {
      res = datastore_rmdir(ds_str, dir_path);
      if( res.error ) {
         console.log(res);
         process.exit(1);
      }
   }

   if( !stat_dirs(ds_str, ['/dir1', '/dir1/dir2'], true) ) {
      process.exit(1);
   }

   process.exit(0);
}
else {
   console.log("No command given");
   console.log(`args = ${args}`);
   console.log(`command = ${command}`);
   assert(0);
}

console.log(JSON.stringify(res));
