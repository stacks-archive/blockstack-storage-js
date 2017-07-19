'use strict'

import MockLocalStorage from 'mock-localstorage'

global.localStorage = new MockLocalStorage()

import {
   createDatastore,
   deleteDatastore,
   getDatastore,
   datastoreMkdir,
   datastoreRmdir,
   datastoreListdir,
   datastoreGetFile,
   datastoreGetFileURL,
   datastorePutFile,
   datastoreDeleteFile,
   datastoreStat,
   getOrCreateDatastore
} from './testlib';

import {
   datastoreGetId,
   decodePrivateKey,
} from '../../../lib/';

import {
   makeInodeHeaderBlob
} from '../../../lib/';

import {
   getCoreSession,
   makeAuthRequest
} from "blockstack";

const assert = require('assert');
const bitcoinjs = require('bitcoinjs-lib');
const http = require('http');
const jsontokens = require('jsontokens');
const BigInteger = require('bigi');
const Promise = require('promise');
const uuid = require('uuid');
const URL = require('url');

var args = process.argv.slice(2);
var command = null;
if( args.length == 0 ) {
   command = "unittest";
}
else {
   command = args[0];
}

var res = null;

function dir_expect(dir, names) {
   for (var name of names) {
      if( !Object.keys(dir['children']).includes(name) ) {
         return false;
      }
   }
   return true;
}

function dir_absent(ds_str, dir_path) {
   return datastoreListdir(ds_str, dir_path).then(
   (idata) => {
        console.log(`listdir ${dir_path} got result: ${JSON.stringify(idata)}`);
        return false;
   },
   (error) => {
        console.log(`listdir ${dir_path} failed`);
        console.log(error);
        console.log(JSON.stringify(error));
        return true;
   });
}

function stat_dir(ds_str, dir_path, expect_error) {
   return datastoreStat(ds_str, dir_path).then(
   (inode) => {
        console.log(`stat dir ${dir_path} got result: ${JSON.stringify(inode)}`);
        assert(inode);
        assert(!inode.error);
        assert(!inode.errno);
        if( inode.type != 2 ) {
           console.log(inode);
           return false;
        }

        return true;
   },
   (error) => {
        console.log(`stat ${dir_path} failed`);
        console.log(error);
        console.log(JSON.stringify(error));
        if (expect_error) {
           return true;
        }
        else {
           return false;
        }
   });
}

function stat_file(ds_str, file_path, expect_error) {
   return datastoreStat(ds_str, file_path).then(
   (inode) => {
        console.log(`stat file ${file_path} got result: ${JSON.stringify(inode)}`);
        assert(inode);
        assert(!inode.error);
        assert(!inode.errno);
        if( inode.type != 1 ) {
           console.log(inode);
           return false;
        }

        return true;
   },
   (error) => {
        console.log(`stat ${file_path} failed`);
        console.log(error);
        console.log(JSON.stringify(error));

        if (expect_error) {
           return true;
        }
        else {
           return false;
        }
   });
}


function file_expect(ds_str, file_path, content) {
   return datastoreGetFile(ds_str, file_path).then(
   (idata) => {
        console.log(`getfile ${file_path} got result: ${JSON.stringify(idata)}`);
        if( idata.error || !idata ) {
           if( expect_error ) {
              return true;
           }
           else {
              console.log(idata.error);
              return false;
           }
        }

        if( idata != content ) {
           console.log(`expected ${content}; got ${idata}`);
        }
        return true;
   },
   (error) => {
        console.log(`getfile ${file_path} failed`);
        console.log(error);
        console.log(JSON.stringify(error));
        return false;
   })
   .then((res) => {
      if (!res) {
         return false;
      }

      // test getFileURL
      return datastoreGetFileURL(ds_str, file_path);
   })
   .then((fileURL) => {

      console.log(`getFileURL ${file_path} got result: ${fileURL}`);

      // parse it
      let urlinfo = URL.parse(fileURL);
      let host = urlinfo.hostname;
      let port = urlinfo.port;
      let path = urlinfo.path;
      
      const options = {
         'method': 'GET',
         'host': host,
         'port': port,
         'path': path, 
      };

      return fetch(fileURL, options);
   })
   .then((response) => {
      if (response.status != 200) {
         throw new Error(`Got HTTP ${response.status} from ${fileURL}`);
      }
      
      return response.text();
   })
   .then((text) => {
      if (text !== content) {
         console.log(`expected: ${content}`);
         console.log(`got: ${text}`);
          throw new Error("Invalid text");
      }

      return true
   })
   .catch((error) => {
      console.log(error);
      console.log(JSON.stringify(error));
      return false;
   });
}


function file_absent(ds_str, file_path) {
   return datastoreGetFile(ds_str, file_path).then(
   (idata) => {
        console.log(`getfile ${file_path} got result: ${JSON.stringify(idata)}`);
        if (idata) {
           return false;
        }
        else {
           return true;
        }
   },
   (error) => {
        console.log(`getfile ${file_path} failed`);
        console.log(error);
        console.log(JSON.stringify(error));
        return false;
   });
}


function http_request(options) {

   var p = new Promise(function(resolve, reject) {
      http.request(options, function(response) {
         var strbuf = [];
         response.on('data', function(chunk) {
            strbuf.push(chunk);
         });

         response.on('end', function() {
            if( response.statusCode != 200 ) {
               return reject("HTTP Status " + response.statusCode);
            }

            var str = Buffer.concat(strbuf).toString();
            var resp = JSON.parse(str);
            str = null;
            strbuf = null;

            resolve(resp);
         });

         response.on('error', function() {
            reject(resp);
         });
      }).end();
   });
   return p;
}

function node_ping(host, port) {
   var options = {
      'method': 'GET',
      'host': host,
      'port': port,
      'path': '/v1/node/ping',
   };

   return http_request(options);
}

/*
 * Run all unit tests.
 * Returns a Promise onto which more tests can be tacked on.
 */
function do_unit_tests( blockchain_id ) {

   // test making an inode header blob...
   var hdr = makeInodeHeaderBlob("1BjnYXfXbh84Xrc24zM1GFvCrXenp8AqUZ", 2, "1BjnYXfXbh84Xrc24zM1GFvCrXenp8AqUZ", "86ce29a7-0714-4136-bfbc-d48f2e55afd4", "9ceb6a079746a67defdadd7ad19a4c9e070a7e5dd2d41df9fc6e3d289e8e49c4", "c429b777-c7b9-4e07-99ba-7cdf98a283c3", 1);

   var api_password = "blockstack_integration_test_api_password";
   var test_host = 'localhost';
   var test_port = 16268;
   var device_id = "0"; // uuid.v4();
   var datastore_privkey = bitcoinjs.ECPair.makeRandom();
   var datastore_privkey_hex = datastore_privkey.d.toBuffer().toString('hex');
   var datastore_pubkey_hex = datastore_privkey.getPublicKeyBuffer().toString('hex');

   // TODO: this isn't the actual datastore ID in the multi-player configuration
   var datastore_id = datastoreGetId(datastore_pubkey_hex);
   var res = null;
   var datastore = null;
   var datastore_str = null;
   var session_token = null;
   
   localStorage.removeItem("blockstack");

   console.log(`private key is ${datastore_privkey_hex}`);
   console.log(`public key is ${datastore_pubkey_hex}`);
   console.log("begin ping");

   return node_ping(test_host, test_port)
      .then((res) => {

           console.log(`ping result: ${JSON.stringify(res)}`);

           var auth_request = makeAuthRequest(datastore_privkey_hex, "https://www.foo.com/login", "https://www.foo.com/manifest.json", ['store_read', 'store_write', 'store_admin'], "https://www.foo.com");
           return getCoreSession(test_host, test_port, api_password, datastore_privkey_hex, blockchain_id, auth_request);

      }, (error) => {console.log(JSON.stringify(error)); process.exit(1);})
      .then((token_res) => {

           console.log(`session result: ${JSON.stringify(token_res)}`);
           session_token = token_res;
           if( !session_token ) {
              console.log("failed to authenticate");
              process.exit(1);
           }

           return getOrCreateDatastore({'local': 1}, session_token, datastore_privkey_hex);

      }, (error) => {console.log("get session token failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`getOrCreateDatastore (create) result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           // make sure it's idempotent
           return getOrCreateDatastore({'local': 1}, session_token, datastore_privkey_hex);

      }, (error) => {console.log("getOrCreateDatastore (create) failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`getOrCreateDatastore (get) result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              console.log("exiting");
              process.exit(1);
           }

           datastore = res.datastore;
           datastore_str = JSON.stringify(res);

           return datastoreMkdir(datastore_str, '/dir1');

      }, (error) => {console.log("getOrCreateDatastore (get) failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastoreMkdir result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              console.log(JSON.stringify(res.error));
              console.log("exiting");
              process.exit(1);
           }

           return datastoreMkdir(datastore_str, '/dir1/dir2');

      }, (error) => {console.log("mkdir /dir1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastoreMkdir result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return datastorePutFile(datastore_str, '/file1', "hello world");

      }, (error) => {console.log("mkdir /dir1/dir2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastorePutFile result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return datastorePutFile(datastore_str, '/dir1/file2', "hello world 2");

      }, (error) => {console.log("putfile /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastorePutFile result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return datastorePutFile(datastore_str, '/dir1/dir2/file3', 'hello world 3');

      }, (error) => {console.log("putfile /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastorePutFile result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return datastoreListdir(datastore_str, '/');

      }, (error) => {console.log("putfile /dir1/dir2/file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastoreListdir result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              console.log(res);
              process.exit(1);
           }

           if( !dir_expect(res, ['dir1', 'file1']) ) {
              console.log("Missing dir1 or file1");
              console.log(res);
              process.exit(1);
           }

           return datastoreListdir(datastore_str, '/dir1');

      }, (error) => {console.log("listdir / failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastoreListdir result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              console.log(res);
              process.exit(1);
           }

           if( !dir_expect(res, ['dir2', 'file2']) ) {
              console.log("Missing dir2 or file2");
              console.log(res);
              process.exit(1);
           }

           return stat_dir(datastore_str, '/');

      }, (error) => {console.log("listdir /dir1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_dir result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_dir(datastore_str, '/dir1');

      }, (error) => {console.log("stat dir / failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_dir result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_dir(datastore_str, '/dir1/dir2');

      }, (error) => {console.log("stat dir /dir1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_dir result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, '/file1');

      }, (error) => {console.log("stat dir /dir1/dir2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, '/dir1/file2');

      }, (error) => {console.log("stat file /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, '/dir1/dir2/file3');

      }, (error) => {console.log("stat file /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, '/file1', 'hello world');

      }, (error) => {console.log("stat file /dir1/dir2/file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, '/dir1/file2', 'hello world 2');

      }, (error) => {console.log("get file /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, '/dir1/dir2/file3', 'hello world 3');

      }, (error) => {console.log("get file /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              process.exit(1);
           }
           return datastoreDeleteFile(datastore_str, '/file1');

      }, (error) => {console.log("get file /dir1/dir2/file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`deletefile result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              process.exit(1);
           }
           return datastoreDeleteFile(datastore_str, '/dir1/file2');

      }, (error) => {console.log("delete file /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`deletefile result: ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return datastoreDeleteFile(datastore_str, '/dir1/dir2/file3');

      }, (error) => {console.log("delete file /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`deletefile result: ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return stat_file(datastore_str, '/file1', true);

      }, (error) => {console.log("delete file /dir1/dir2/file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result (expect failure): ${JSON.stringify(res)}`);
           if( !res || res.error) {
              process.exit(1);
           }
           return stat_file(datastore_str, '/dir1/file2', true);

      }, (error) => {console.log("stat /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result (expect failure): ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return stat_file(datastore_str, '/dir1/dir2/file3', true);

      }, (error) => {console.log("stat file /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return file_absent(datastore_str, '/file1');

      }, (error) => {console.log("stat file /dir1/dir2/file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_absent result (expect failure): ${JSON.stringify(res)}`);
           if( !res || res.error) {
              process.exit(1);
           }
           return file_absent(datastore_str, '/dir1/file2');

      }, (error) => {console.log("getFile /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_absent result (expect failure): ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return file_absent(datastore_str, '/dir1/dir2/file3', true);

      }, (error) => {console.log("getFile /dir1/file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_absent result (expect failure): ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return datastoreRmdir(datastore_str, '/dir1/dir2');

      }, (error) => {console.log("getFile /dir1/dir2/file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`rmdir result: ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return datastoreRmdir(datastore_str, '/dir1');

      }, (error) => {console.log("rmdir /dir1/dir2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`rmdir result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return dir_absent(datastore_str, '/dir1/dir2');

      }, (error) => {console.log("rmdir /dir1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`dir_absent result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              console.log(res);
              process.exit(1);
           }

           return dir_absent(datastore_str, '/dir1');

      }, (error) => {console.log("listdir /dir1/dir2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`dir_absent result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              console.log(res);
              process.exit(1);
           }

           return stat_dir(datastore_str, '/dir1', true);

      }, (error) => {console.log("listdir /dir1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_dir result: ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }
           return stat_dir(datastore_str, '/dir1/dir2', true);

      }, (error) => {console.log("stat dir /dir1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_dir result: ${JSON.stringify(res)}`);
           if( !res || res.error ) {
              process.exit(1);
           }

           return deleteDatastore(datastore_str);
      }, (error) => {console.log("stat dir /dir1/dir2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`delete datastore result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
      }, (error) => {console.log("delete datastore failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);});
}

if( command == 'createDatastore' ) {
   assert(args.length >= 5);
   res = createDatastore(args[1], args[2], args[3], args[4], args[5])
}
else if( command == 'deleteDatastore') {
   assert(args.length >= 2);
   res = deleteDatastore(args[1]);
}
else if( command == 'getDatastore') {
   assert(args.length >= 5);
   res = getDatastore(args[1], args[2], args[3], args[4]);
}
else if( command == 'mkdir' ) {
   assert(args.length >= 3);
   res = datastoreMkdir(args[1], args[2], args[3], args[4]);
}
else if( command == 'rmdir' ) {
   assert(args.length >= 3);
   res = datastoreRmdir(args[1], args[2], args[3], args[4]);
}
else if( command == 'listdir' ) {
   assert(args.length >= 3 );
   res = datastoreListdir(args[1], args[2], args[3], args[4]);
}
else if( command == 'getfile' ) {
   assert(args.length >= 3);
   res = datastoreGetFile(args[1], args[2], args[3], args[4]);
}
else if( command == 'putfile' ) {
   assert(args.length >= 4);
   res = datastorePutFile(args[1], args[2], args[3], args[4], args[5]);
}
else if( command == 'deletefile' ) {
   assert(args.length >= 3);
   res = datastoreDeleteFile(args[1], args[2]);
}
else if( command == 'stat' ) {
   assert(args.length >= 3 );
   res = datastoreStat(args[1], args[2]);
}
else if( command == 'unittest' ) {
   do_unit_tests(null)
   .then((result) => {
      return do_unit_tests("judecn.id");
   })
   .then((result) => {
      process.exit(0);
   })
   .catch((error) => {
      console.log(error);
      console.log(JSON.stringify(error));
      process.exit(1);
   });
}
else {
   console.log("No command given");
   console.log(`args = ${args}`);
   console.log(`command = ${command}`);
   assert(0);
}
