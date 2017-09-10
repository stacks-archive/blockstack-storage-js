'use strict'

import MockLocalStorage from 'mock-localstorage'

global.localStorage = new MockLocalStorage()

import {
   createDatastore,
   deleteDatastore,
   getDatastore,
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
   datastoreCreateSetRetry
} from '../../../lib/';

import {
   getUserData,
   setUserData,
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

function stat_file(ds_str, file_path, blockchain_id, expect_error) {
   return datastoreStat(ds_str, file_path).then(
   (inode) => {
        console.log(`stat file ${file_path} got result: ${JSON.stringify(inode)}`);
        assert(inode);
        assert(!inode.error);
        assert(!inode.errno);

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
   let options = null;
   let fileURL = null;

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
/*
      // test getFileURL
      return datastoreGetFileURLs(ds_str, file_path);
   })
   .then((fileurls) => {
      fileURLs = fileurls;

      console.log(`getFileURLs ${file_path} got result: ${fileURLs.join(',')}`);
      
      // parse it
      fileURL = fileURLs[0];
      let urlinfo = URL.parse(fileURL);
      let host = urlinfo.hostname;
      let port = urlinfo.port;
      let path = urlinfo.path;
      
      options = {
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

      // test range (lower bound)
      options['headers'] = {
         'range': `bytes=0-${parseInt(parseInt(content.length/2))}`
      };

      return fetch(fileURL, options);
   })
   .then((response) => {
      if (response.status != 206) {
         throw new Error(`Got HTTP ${response.status} from ${fileURL}`);
      }

      return response.text();
   })
   .then((text) => {
      if (text !== content.slice(0,parseInt(content.length/2)+1)) {
         console.log(`expected: ${content.slice(0,parseInt(content.length/2)+1)}`);
         console.log(`got: ${text}`);
         throw new Error("Invalid text (lower half)");
      }

      // test range (upper bound)
      options['headers'] = {
         'range': `bytes=${parseInt(content.length/2)}-${content.length}`
      };

      return fetch(fileURL, options);
   })
   .then((response) => {
      if (response.status != 206) {
         throw new Error(`Got HTTP ${response.status} from ${fileURL}`);
      }

      return response.text();
   })
   .then((text) => {
      if (text !== content.slice(parseInt(content.length/2),content.length)) {
         console.log(`expected: ${content.slice(parseInt(content.length/2), content.length)}`);
         console.log(`got: ${text}`);
         throw new Error("Invalid text (upper half)");
      }

      // text overflow range 
      options['headers'] = {
         'range': `bytes=${content.length}-${content.length+1}`
      };

      return fetch(fileURL, options);
   })
   .then((response) => {
      if (response.status != 206) {
         throw new Error(`Got HTTP ${response.status} from ${fileURL}`);
      }

      return response.text();
   })
   .then((text) => {
      if (text !== "") {
         console.log("expected: ''");
         console.log(`got: ${text}`);
         throw new Error("Invalid text (overflow)");
      }
*/
      return true;
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
function do_unit_tests_write( blockchain_id, privkey=null, create_datastore=true, delete_files=true ) {

   var api_password = "blockstack_integration_test_api_password";
   var test_host = 'localhost';
   var test_port = 16268;
   var device_id = "0"; // uuid.v4();
   var datastore_privkey = null;
   var datastore_privkey_hex = null;

   if (!privkey) {
       datastore_privkey = bitcoinjs.ECPair.makeRandom();
       datastore_privkey_hex = datastore_privkey.d.toBuffer().toString('hex');
   }
   else {
       datastore_privkey_hex = privkey;
       var datastore_privkey_int = BigInteger.fromBuffer( decodePrivateKey(privkey_hex) );
       datastore_privkey = new bitcoinjs.ECPair(datastore_privkey_int);
   }

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

           var auth_request = makeAuthRequest(datastore_privkey_hex, "http://localhost.1:8888/login", "http://localhost.1:8888/manifest.json", ['store_read', 'store_write', 'store_admin'], "http://localhost.1:8888");
           return getCoreSession(test_host, test_port, api_password, datastore_privkey_hex, blockchain_id, auth_request);

      }, (error) => {console.log(JSON.stringify(error)); process.exit(1);})
      .then((token_res) => {

           console.log(`session result: ${JSON.stringify(token_res)}`);
           session_token = token_res;
           if( !session_token ) {
              console.log("failed to authenticate");
              process.exit(1);
           }

           if (create_datastore) {
               return getOrCreateDatastore({'local': 1}, session_token, datastore_privkey_hex);
           }
           else {

               // store (simulate sign-in)
               var user_data = getUserData();
               user_data.coreSessionToken = session_token;
               setUserData(user_data);

               var app_name = URL.parse(jsontokens.decodeToken(session_token).payload.app_domain).host;
               return getDatastore({'blockchainID': blockchain_id, 'appName': app_name, 'appPrivateKey': datastore_privkey_hex})
           }

      }, (error) => {console.log("get session token failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (create_datastore) {
               console.log(`getOrCreateDatastore (create) result: ${JSON.stringify(res)}`);
           }
           else {
               console.log(`getDatastore result: ${JSON.stringify(res)}`);
           }

           if( !res || res.error ) {
              console.log(res);
              process.exit(1);
           }

           if (create_datastore) {
               // make sure it's idempotent
               return getOrCreateDatastore({'local': 1}, session_token, datastore_privkey_hex);
           }
           else {
               datastore = res.datastore;
               datastore_str = JSON.stringify(res);
               return true;
           }

      }, (error) => {console.log(`get/create datastore (create=${create_datastore}) failed:`); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (create_datastore) {
               console.log(`getOrCreateDatastore (create) result: ${JSON.stringify(res)}`);
           }
           else {
               console.log(`getDatastore result: ${JSON.stringify(res)}`);
           }

           if( !res || res.error ) {
              console.log(res);
              process.exit(1);
           }

           if (create_datastore) {
               // must have been idempotent 
               if (res.created) {
                  console.log(res);
                  console.log('accidentally recreated datastore');
                  process.exit(1);
               }

               // make sure we can recreate it 
               datastoreCreateSetRetry(session_token);
               return getOrCreateDatastore({'local': 1}, session_token, datastore_privkey_hex);
           }
           else {
               datastore = res.datastore;
               datastore_str = JSON.stringify(res);
               return true;
           }

      }, (error) => {console.log(`get/create datastore (create=${create_datastore}) failed:`); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (create_datastore) {
               console.log(`getOrCreateDatastore (get) result: ${JSON.stringify(res)}`);
               if( !res || res.error ) {
                  console.log(res);
                  console.log("exiting");
                  process.exit(1);
               }

               // make sure it was created
               if (!res.created) {
                  console.log(res);
                  console.log('did not recreate datastore as expected');
                  process.exit(1);
               }

               datastore = res.datastore;
               datastore_str = JSON.stringify(res);
           }

           return datastorePutFile(datastore_str, 'file1', "hello world");

      }, (error) => {console.log("getOrCreateDatastore failed (forced recreate):"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastorePutFile result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return datastorePutFile(datastore_str, 'file2', "hello world 2");

      }, (error) => {console.log("putfile file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastorePutFile result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }

           return datastorePutFile(datastore_str, 'file3', 'hello world 3');

      }, (error) => {console.log("putfile file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`datastorePutFile result: ${JSON.stringify(res)}`);
           if( res.error ) {
              console.log(res);
              process.exit(1);
           }
           return stat_file(datastore_str, 'file1');

      }, (error) => {console.log("putfile file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, 'file2');

      }, (error) => {console.log("stat file file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, 'file3');

      }, (error) => {console.log("stat file file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, 'file1', 'hello world');

      }, (error) => {console.log("stat file file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, 'file2', 'hello world 2');

      }, (error) => {console.log("get file /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, 'file3', 'hello world 3');

      }, (error) => {console.log("get file file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (delete_files) {
              console.log(`file_expect result: ${JSON.stringify(res)}`);
              if( !res || res.error) {
                 process.exit(1);
              }
              return datastoreDeleteFile(datastore_str, 'file1');
           }
           else {
              return true;
           }

      }, (error) => {console.log("get file file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (delete_files) {
               console.log(`deletefile result: ${JSON.stringify(res)}`);
               if( !res || res.error) {
                  process.exit(1);
               }
               return datastoreDeleteFile(datastore_str, 'file2');
           }
           else {
               return true;
           }

      }, (error) => {console.log("delete file file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (delete_files) {
               console.log(`deletefile result: ${JSON.stringify(res)}`);
               if( !res || res.error ) {
                  process.exit(1);
               }
               return datastoreDeleteFile(datastore_str, 'file3');
           }
           else {
               return true;
           }

      }, (error) => {console.log("delete file file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {
        
           if (delete_files) {
               console.log(`deletefile result: ${JSON.stringify(res)}`);
               if( !res || res.error ) {
                  process.exit(1);
               }
               return file_absent(datastore_str, 'file1');
           }
           else {
               return true;
           }

      }, (error) => {console.log("delete file file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {
            
           if (delete_files) {
               console.log(`file_absent result (expect failure): ${JSON.stringify(res)}`);
               if( !res || res.error) {
                  process.exit(1);
               }
               return file_absent(datastore_str, 'file2');
           }
           else {
               return true;
           }

      }, (error) => {console.log("failed to verify that file1 was absent:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (delete_files) {
               console.log(`file_absent result (expect failure): ${JSON.stringify(res)}`);
               if( !res || res.error ) {
                  process.exit(1);
               }
               return file_absent(datastore_str, 'file3', true);
           }
           else {
               return true;
           }

      }, (error) => {console.log("failed to verify that file2 was absent:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           if (delete_files) {
               console.log(`file_absent result (expect failure): ${JSON.stringify(res)}`);
               if( !res || res.error ) {
                  process.exit(1);
               }

               return deleteDatastore(datastore_str);
           }
           else {
               return true;
           }
      }, (error) => {console.log("failed to verify that file3 was absent failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {
        
           if (delete_files) {
               console.log(`delete datastore result: ${JSON.stringify(res)}`);
               if( !res ) {
                  process.exit(1);
               }
           }

      }, (error) => {console.log("delete datastore failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);});
}


/*
 * Read from an existing blockchain ID
 * Returns a Promise onto which more tests can be tacked on.
 */
function do_unit_tests_read( blockchain_id, app_name ) {

   var api_password = "blockstack_integration_test_api_password";
   var test_host = 'localhost';
   var test_port = 16268;
   var device_id = "0"; // uuid.v4();
   
   var datastore_privkey = bitcoinjs.ECPair.makeRandom();
   var datastore_privkey_hex = datastore_privkey.d.toBuffer().toString('hex');

   var session_token = null;
   var datastore_str = '{}';

   localStorage.removeItem("blockstack");

   console.log("begin ping");

   return node_ping(test_host, test_port)
      .then((res) => {

           console.log(`ping result: ${JSON.stringify(res)}`);

           var auth_request = makeAuthRequest(datastore_privkey_hex, "http://localhost.1:8888/login", "http://localhost.1:8888/manifest.json", ['store_read', 'store_write', 'store_admin'], "http://localhost.1:8888");
           return getCoreSession(test_host, test_port, api_password, datastore_privkey_hex, blockchain_id, auth_request);

      }, (error) => {console.log(JSON.stringify(error)); process.exit(1);})
      .then((token_res) => {

           console.log(`session result: ${JSON.stringify(token_res)}`);
           session_token = token_res;
           if( !session_token ) {
              console.log("failed to authenticate");
              process.exit(1);
           }

           // store (simulate sign-in)
           var user_data = getUserData();
           user_data.coreSessionToken = session_token;
           setUserData(user_data);

           return stat_file(datastore_str, 'file1', blockchain_id);

      }, (error) => {console.log("ping failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, 'file2', blockchain_id);

      }, (error) => {console.log("stat file file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return stat_file(datastore_str, 'file3', blockchain_id);

      }, (error) => {console.log("stat file file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`stat_file result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, 'file1', 'hello multireader storage file1');

      }, (error) => {console.log("stat file file3 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, 'file2', 'hello multireader storage file2');

      }, (error) => {console.log("get file /file1 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res ) {
              process.exit(1);
           }
           return file_expect(datastore_str, 'file3', 'hello multireader storage file3');

      }, (error) => {console.log("get file file2 failed:"); console.log(error); console.log(JSON.stringify(error)); process.exit(1);})
      .then((res) => {

           console.log(`file_expect result: ${JSON.stringify(res)}`);
           if( !res || res.error) {
              process.exit(1);
           }

           return true;

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
   do_unit_tests_write(null, null)
   .then((result) => {
      process.exit(0);
   })
   .catch((error) => {
      console.log(error);
      console.log(JSON.stringify(error));
      process.exit(1);
   });
}
else if( command == 'unittest_read' ) {
   var blockchain_id = args[1];
   if (!blockchain_id) {
      blockchain_id = 'demo.id';
   }

   do_unit_tests_read(blockchain_id)
   .then((result) => {
      process.exit(0);
   })
   .catch((error) => {
      console.log(error);
      console.log(JSON.stringify(error));
      process.exit(1);
   });
}
else if( command == 'unittest_write' ) {
   var blockchain_id = args[1];
   var privkey_hex = args[2];

   if (!blockchain_id) {
      blockchain_id = 'demo.id';
   }

   if (!privkey_hex) {
      var privkey = bitcoinjs.ECPair.makeRandom();
      privkey_hex = datastore_privkey.d.toBuffer().toString('hex');
      console.log(`private key is ${privkey_hex}`);
   }

   do_unit_tests_write(blockchain_id, privkey_hex, false, false)
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
