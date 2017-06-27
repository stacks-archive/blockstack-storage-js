# Blockstack Storage JS

Blockstack storage API access for Javascript clients.

## Creating a file

```
new Promise((resolve), (reject) => {
   blockstack.putFile("/hello_world", "hello world!")
   .then(() => {

      // /hello_world exists now, and has the contents "hello world!".
      resolve(true);
   });
});
```

## Reading a file

```
new Promise((resolve), (reject) => {
   blockstack.getFile("/hello_world")
   .then((fileContents) => {

      // get back the file /hello_world
      assert(fileContents === "hello world!");
   });
});
```

```
new Promise((resolve), (reject) => {
   blockstack.getFile("/non/existant/file")
   .then((absentFileContents) => {

      // no data if it doesn't exist
      assert(absentFileContents === null);
   });
});
```

## Making a directory

```
new Promise((resolve), (reject) => {
   blockstack.mkdir("/home")
   .then(() => {
    
      return blockstack.mkdir("/home/demo1");
   })
   .then(() => {

      return blockstack.mkdir("/home/demo2");
   })
   .then(() => {
      
      return blockstack.mkdir("/home/demo3");
   })
   .then(() => {
      
      // directory '/home' exists, and has
      // children 'demo1', 'demo2', and 'demo3'
      resolve(true);
   });
});
```

## Listing directories

```
new Promise((resolve), (reject) => {
   blockstack.listdir("/home")
   .then((dir) => {

      // have 'demo1', 'demo2', and 'demo3'
      assert(dir.children.length === 3);
      
      for (let name of ['demo1', 'demo2', 'demo3']) {
         if( !Object.keys(dir['children']).includes(name) ) {
            reject(`Missing ${name}`);
         }
      }

      resolve(true);
   });
});
```

## Stat path

```
new Promise((resolve), (reject) => {
   blockstack.stat("/home")
   .then((dirHeader) => {
      // path exists
      resolve(true);
   })
   .catch((error) => {
      // path does not exist
      reject(error);
   });
});
```

## Deleting a file

```
new Promise((resolve), (reject) => {
   blockstack.deleteFile("/hello_world")
   .then(() => {
      // file was deleted
      resolve(true);
   })
   .catch((error) => {
      // file does not exist or is inaccessable
      reject(error);
   });
});
```


## Removing a directory

```
new Promise((resolve), (reject) => {
   blockstack.rmdir("/home/demo1")
   .then(() => {
       // can delete empty directories,
       // but not non-empty ones.
       return blockstack.rmdir("/home")
       .catch((error) => {

           // delete children 
           return Promise.all([blockstack.rmdir("/home/demo2"), blockstack.rmdir("/home/demo3")]);
       })
       .then((results) => {

           // delete parent 
           return blockstack.rmdir("/home");
       })
       .then(() => {

           // / is now empty 
           resolve(true);
       });
   });
});
```

