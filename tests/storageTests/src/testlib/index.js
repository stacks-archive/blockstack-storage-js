'use strict'

const datastore = require('../../../../lib/');

// create a datastore
export function createDatastore( privkey, session, device_id, all_device_ids, drivers ) {

   // will be a stringified array
   all_device_ids = JSON.parse(all_device_ids);

   if( drivers ) {
       drivers = JSON.parse(drivers);
   }
   else {
       drivers = ['disk'];
   }

   console.log(`createDatastore(${privkey}, ${session}, ${device_id}, ${all_device_ids})`);

   var info = datastore.datastoreCreateRequest('datastore', privkey, drivers, device_id, all_device_ids );
   var res = datastore.datastoreCreate( 'localhost:6270', session, info );
   return res;
}


// get datastore 
export function getDatastore(opts) {
   console.log(`getDatastore(${JSON.stringify(opts)})`);
   return datastore.datastoreMount(opts);
}

// get or create 
export function getOrCreateDatastore( replication_strategy, session, privkey ) {
   console.log(`getOrCreateDatastore(${replication_strategy}, ${session}, ${privkey})`);
   return datastore.datastoreMountOrCreate(replication_strategy, session, privkey );
}

// delete datastore 
export function deleteDatastore(ds_str) {

   // ds will be JSON-string 
   var ds = JSON.parse(ds_str);

   console.log(`deleteDatastore(${ds.privkey_hex}`);
   return datastore.datastoreDelete(ds);
}


// getfile 
export function datastoreGetFile(ds_str, path, blockchain_id) {

   // ds will be JSON-string 
   var ds = JSON.parse(ds_str);

   var opts = {
      'blockchainID': blockchain_id,
   };

   console.log(`getfile(${ds.privkey_hex}, ${path}, ${blockchain_id})`);
   return datastore.getFile(path, opts);
}


// getfileurl 
export function datastoreGetFileURLs(ds_str, path, blockchain_id) {

   // ds will be JSON string 
   var ds = JSON.parse(ds_str);

   var opts = {
      'blockchainID': blockchain_id,
      'app_name': 'localhost.1:8888',
   };

   console.log(`getFileURL(${ds.privkey_hex}, ${path}, ${blockchain_id})`);
   return datastore.getFileURL(path, opts);
}


// putfile 
export function datastorePutFile(ds_str, path, data_str) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);

   console.log(`putfile(${ds.privkey_hex}, ${path})`);
   return datastore.putFile(path, Buffer.from(data_str), {});
}


// deletefile
export function datastoreDeleteFile(ds_str, path) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);

   console.log(`deletefile(${ds.privkey_hex}, ${path})`);
   return datastore.deleteFile(path, {});
}


// stat
export function datastoreStat(ds_str, path, blockchain_id) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);

   console.log(`stat(${ds.privkey_hex}, ${path})`);
   return datastore.getFileURLs(path, {'blockchainID': blockchain_id});
}
