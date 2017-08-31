'use strict'

const LOCAL_STORAGE_ID = 'blockstack';

const urlparse = require('url');
const crypto = require('crypto');
const jsontokens = require('jsontokens');
const assert = require('assert');

import {
   hashRawData
} from './util';


/*
 * Get a reference to our localStorage implementation
 */
function getLocalStorage() {
   // uncomment when testing locally.  Make sure node-localstorage is installed!
   /*
   let localStorage = null;
    
   if (typeof window === 'undefined' || window === null) {
      const LocalStorage = require('node-localstorage').LocalStorage;
      localStorage = new LocalStorage('./scratch');
   }
   else {
      localStorage = window.localStorage;
   }
   */
   return localStorage;
}


/*
 * Get local storage object for Blockstack
 * Throws on error
 */
export function getUserData() {

   const localStorage = getLocalStorage();
   let userData = localStorage.getItem(LOCAL_STORAGE_ID);
   if (userData === null || typeof(userData) === 'undefined') {
      userData = '{}';
   }

   userData = JSON.parse(userData);
   return userData;
}


/*
 * Save local storage
 */
export function setUserData(userData) {

   let u = getUserData();
   if (u.coreSessionToken && userData.coreSessionToken) {
      // only store the newer one 
      let coreSessionToken = null;
      if (u.coreSessionToken.timestamp < userData.coreSessionToken.timestamp) {
         coreSessionToken = userData.coreSessionToken;
      }
      else {
         coreSessionToken = u.coreSessionToken;
      }
      userData.coreSessionToken = coreSessionToken;
   }
   
   localStorage.setItem(LOCAL_STORAGE_ID, JSON.stringify(userData));
}

/*
 * Get a cached app-specific datastore mount context for a given blockchain ID and application
 * Return null if not found
 * Throws on error
 */
export function getCachedMountContext(blockchain_id, full_app_name) {

   let userData = getUserData();
   assert(userData);

   assert(blockchain_id, 'No blockchain ID given');
   assert(full_app_name, 'No app name given');

   let cache_key = `${blockchain_id}/${full_app_name}`

   if (!userData.datastore_contexts) {
      console.log("No datastore contexts defined");
      return null;
   }

   if (!userData.datastore_contexts[cache_key]) {
      console.log(`No datastore contexts for ${blockchain_id} in ${full_app_name}`);
      return null;
   }

   let ctx = userData.datastore_contexts[cache_key];
   if (!ctx) {
      console.log(`Null datastore context for ${blockchain_id} in ${full_app_name}`);
      return null;
   }

   return ctx;
}


/*
 * Cache a mount context for a blockchain ID
 *
 * @param blockchain_id (string) the blockchain ID
 * @param datastore_context (object) the datastore mount context
 */
export function setCachedMountContext(blockchain_id, full_app_name, datastore_context) {

   let userData = getUserData();
   assert(userData);

   assert(blockchain_id, 'No blockchain ID given');
   assert(full_app_name, 'No app name given');

   if (!userData.datastore_contexts) {
      userData.datastore_contexts = {};
   }

   let cache_key = `${blockchain_id}/${full_app_name}`
   console.log(`Cache datastore for ${blockchain_id} in ${full_app_name}`);

   userData.datastore_contexts[cache_key] = datastore_context;
   setUserData(userData);
}


/*
 * Get the blockchain ID from a session object, or generate a default one
 * if no blockchain ID is set.
 *
 * @param session (object) the parsed session object
 *
 * Returns a string that is either the blockchain ID, or a deterministically-generated base64-encoded string
 * that is consistent for the datastore
 */
export function getBlockchainIDFromSessionOrDefault(session) {
   if (!session.blockchain_id) {
       assert(session.app_user_id, `Missing app_user_id in ${JSON.stringify(session)}`);
       return hashRawData(Buffer.from(session.app_user_id).toString('base64'));
   }
   else {
       return session.blockchain_id;
   }
}


/*
 * Get the session token from localstorage
 */
export function getSessionToken() {
    let userData = getUserData();
    assert(userData);
    assert(userData.coreSessionToken);

    let sessionToken = userData.coreSessionToken;
    return sessionToken;
}


/*
 * Get the current session's blockchain ID
 */
export function getSessionBlockchainID(sessionToken=null) {

   if (!sessionToken) {
      sessionToken = getSessionToken();
   }

   const session = jsontokens.decodeToken(sessionToken).payload;
   return session.blockchain_id;
}


/*
 * Get the fully-qualified application name from the session
 */
export function getSessionAppName(sessionToken=null) {

   if (!sessionToken) {
      sessionToken = getSessionToken();
   }

   const session = jsontokens.decodeToken(sessionToken).payload;
   return urlparse.parse(session.app_domain).host;
}

/*
 * Get the session's device ID 
 */
export function getSessionDeviceID(sessionToken=null) {

   if (!sessionToken) {
      sessionToken = getSessionToken();
   }

   const session = jsontokens.decodeToken(sessionToken).payload;
   return session.device_id;
}


/*
 * Get the version of a device root page
 *
 * @param datastore_id (string) the datastore ID
 * @param root_uuid (string) the root UUID
 * @param device_ids (array) the list of device IDs
 *
 * Returns the version (integer) on success
 * Returns 0 if we don't know
 */
export function getDeviceRootVersion(datastore_id, root_uuid, device_ids) {
   // TODO 
   return 0;
}


/*
 * Put the version of a device root page
 *
 * @param datastore_id (string) the datastore ID
 * @param root_uuid (string) the root UUID
 * @param device_id (string) this device ID
 * @version (integer) the version number
 *
 * returns True
 */
export function putDeviceRootVersion(datastore_id, root_uuid, device_id, version) {
   // TODO 
   return true;
}
