'use strict';

export const SUPPORTED_STORAGE_CLASSES = ["read_public", "write_public", "read_private", "write_private", "read_local", "write_local"];
export const REPLICATION_STRATEGY_CLASSES = {
   'local': new Set(['read_local', 'write_local']),
   'publish': new Set(['read_public', 'write_private']),
   'public': new Set(['read_public', 'write_public']),
   'private': new Set(['read_private', 'write_private']),
};

/*
 * Fulfill a replication strategy using the drivers available to us.
 *
 * replication_strategy (object): a dict that maps strategies (i.e. 'local', 'public', 'private') to integer counts
 * classes (object): this is session.storage.classes (i.e. the driver classification; maps a driver name to its list of classes)
 *
 * Returns the list of drivers to use.
 * Throws on error.
 */
export function selectDrivers(replication_strategy, classes) {

   // select defaults from classification and replication strategy
   let driver_sets = [];            // driver_sets[i] is the set of drivers that support SUPPORTED_STORAGE_CLASSES[i]
   let driver_classes = {};         // map driver name to set of classes
   let all_drivers = new Set([]);   // set of all drivers available to us
   let available_drivers = [];      // drivers available to us
   let selected_drivers = [];       // drivers compatible with our replication strategy (return value)
   let have_drivers = false;        // whether or not we selected drivers that fulfill our replication strategy

   for (let i = 0; i < SUPPORTED_STORAGE_CLASSES.length; i++) {
      let driver_set = new Set(classes[SUPPORTED_STORAGE_CLASSES[i]]);
      driver_sets.push(driver_set);

      for(let d of driver_set) {
          all_drivers.add(d);
      }

      for( let d of driver_set ) {
         console.log(`Driver ${d} implementes ${SUPPORTED_STORAGE_CLASSES[i]}`);
         if (driver_classes[d]) {
            driver_classes[d].push(SUPPORTED_STORAGE_CLASSES[i]);
         }
         else {
            driver_classes[d] = [SUPPORTED_STORAGE_CLASSES[i]];
         }
      }
   }

   let concern_fulfillment = {};

   for (let d of all_drivers) {
      let classes = driver_classes[d];

      // a driver fits the replication strategy if all of its
      // classes matches at least one concern (i.e. 'local', 'public')
      for (let concern of Object.keys(replication_strategy)) {

          let matches = false;
          for (let dclass of classes) {
             if (REPLICATION_STRATEGY_CLASSES[concern].has(dclass)) {
                matches = true;
                break;
             }
          }

          if (matches) {
             console.log(`Driver ${d} fulfills replication concern ${concern}`);

             if (concern_fulfillment[concern]) {
                concern_fulfillment[concern] += 1;
             }
             else {
                concern_fulfillment[concern] = 1;
             }

             if (concern_fulfillment[concern] <= replication_strategy[concern]) {
                console.log(`Select driver ${d}`);
                selected_drivers.push(d);
             }
          }

          // strategy fulfilled?
          let fulfilled = true;
          for (let concern of Object.keys(replication_strategy)) {
             let count = 0;
             if (concern_fulfillment[concern]) {
                count = concern_fulfillment[concern];
             }

             if (count < replication_strategy[concern]) {
                fulfilled = false;
                break;
             }
          }

          if (fulfilled) {
             have_drivers = true;
             break;
          }
      }

      if (have_drivers) {
         break;
      }
   }

   if (!have_drivers) {
      throw new Error("Unsatisfiable replication strategy");
   }

   return selected_drivers;
}

