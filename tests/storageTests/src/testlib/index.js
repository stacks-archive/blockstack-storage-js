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


// get a datastore 
export function GetDatastore(session, datastore_id, privkey, device_id) {

   console.log(`GetDatastore(${session}, ${datastore_id}, ${privkey}, ${device_id}`);
   var res = datastore.datastoreConnect( 'localhost:6270', session, privkey, device_id );
   return res;
}


// get or create 
export function getOrCreateDatastore( hostport, privkey, session, this_device_id, all_device_ids, drivers ) {
   console.log(`getOrCreateDatastore(${hostport}, ${privkey}, ${session}, ${this_device_id}, ${all_device_ids}, ${drivers})`);
   return datastore.datastoreConnectOrCreate(hostport, drivers, privkey, session, this_device_id, all_device_ids);
}

// delete datastore 
export function deleteDatastore(ds_str) {

   // ds will be JSON-string 
   var ds = JSON.parse(ds_str);

   console.log(`deleteDatastore(${ds.privkey_hex}`);
   return datastore.datastoreDelete(ds);
}


// getfile 
export function datastoreGetFile(ds_str, path, extended, force) {

   // ds will be JSON-string 
   var ds = JSON.parse(ds_str);
   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`getfile(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.getFile(ds, path, opts);
}


// putfile 
export function datastorePutFile(ds_str, path, data_str, extended, force) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);
   var data_buf = Buffer.from(ds_str);

   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`putfile(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.putFile(ds, path, Buffer.from(data_str), opts);
}


// deletefile
export function datastoreDeleteFile(ds_str, path, extended, force) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);
   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`deletefile(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.deleteFile(ds, path, opts);
}


// mkdir 
export function datastoreMkdir(ds_str, path, extended, force) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);
   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`mkdir(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.mkdir(ds, path, opts);
}


// listdir 
export function datastoreListdir(ds_str, path, extended, force) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);
   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`listDir(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.listDir(ds, path, opts);
}


// rmdir 
export function datastoreRmdir(ds_str, path, extended, force) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);
   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`rmdir(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.rmdir(ds, path, opts);
}


// stat
export function datastoreStat(ds_str, path, extended, force) {

   // ds will be a json str 
   var ds = JSON.parse(ds_str);
   var extended = (extended == '1');
   var force = (force == '1');

   var opts = {
      'extended': extended,
      'force': force,
   };

   console.log(`stat(${ds.privkey_hex}, ${path}, ${extended}, ${force})`);
   return datastore.stat(ds, path, opts);
}
