'use strict'

export {
   getFile,
   putFile,
   deleteFile,
   listFiles,
   getFileURLs
} from './api'

export * from './errors';

export {
   datastoreGetId,
   datastoreMountOrCreate,
   datastoreMount,
   datastoreDelete,
} from './datastore';

export {
   getUserData,
   setUserData,
} from './metadata';

export {
   decodePrivateKey,
} from './util';
