var PouchDB = require("./pouchdb");
var utils = require("./utils");
var path = require("path");
var spawn = require('child_process').spawn;

module.exports = function RadioPush(db) {

    var self = {};
    var ping = 60 * 1000; // every 1m tell other lanterns we exist

    //------------------------------------------------------------------------
    /**
    * push change over distributed long-range network
    **/
    function addMessageToQueue(msg) {
        if (!msg) return;

        if (utils.isLantern()) {
            console.log("[radio] push message: " + msg);
            var program = spawn(path.resolve(__dirname + "/../bin/queue-message"), [msg]);

            program.stdout.on('data', function (data) {
              console.log('q result: ' + data.toString());
            });

            program.stderr.on('data', function (data) {
              console.log('q err: ' + data.toString());
            });
        }
        else {
            console.log("[radio] simulate push message: " + msg);
        }
    }

    /**
    * let other lanterns know about a key/value change
    **/
    function notifyDocumentUpdate(doc) {
        var msg = buildParameters(doc);
        if (msg.length) {
            addMessageToQueue("^"+doc._id + "::" + msg);
        }
    }
    

    /**
    * let other lanterns know about a new document
    **/
    function notifyDocumentCreate(doc) {
        var msg = buildParameters(doc);
        if (msg.length) {
            addMessageToQueue("+"+doc._id + "::" + msg);
        }
    }


    /**
    * let other lanterns know about a removed document
    **/
    function notifyDocumentRemove(doc_id) {
        addMessageToQueue("-"+doc_id);
    }

    /**
    * let other lanterns know this device is online
    **/
    function notifyLanternOnline() {
        var id = utils.getLanternID();
        if (!id) {
            console.log("[radio] missing lantern id");
        }
        else {
            addMessageToQueue("^d:"+ id + "::st=1");
        }
    }

    /**
    * construct a query-string style list of key/value pairs
    */
    function buildParameters(doc) {
        var params = [];
        for (var k in doc) {
            // ignore private keys that begin with underscore such as _rev
            // find change to keys that are not created_at or updated_at
            if (k[0] != "_" && k != "32" && k != "33") {
                var val = doc[k];
                if (val instanceof Array) {
                    val = val.join(",");
                }
                else if (typeof(val) == "object") {
                    val = JSON.stringify(val);
                }
                params.push(k+"="+val);
            }
        }
        return params.join("&");
    }


    /**
    * handler to process any document change in local lantern database
    **/
    function onChange(change) {
        var msg = "";
        for (var idx in change.changes) {
            console.log(change);
            var doc = change.doc;
            var rev = change.changes[idx].rev;

            console.log(["======", doc._id, rev, "======"].join(" "));

            // filters out changes made from LoRa to prevent echo
            if (doc.rx) {
                console.log("skipping document " + doc._id + "received by radio");
                return;
            }

            // push change over distributed long-range network
            if (doc._deleted) {
                notifyDocumentRemove(doc._id);
            }
            else if(!doc.rx && doc._rev[0] == "1") {
                // assume document has been created if we're at first revision
                notifyDocumentCreate(doc);
            }
            else if (!doc.rx) {
                notifyDocumentUpdate(doc);
            }
        }
    }
    
    

    //------------------------------------------------------------------------
    /**
    * start listening for changes
    **/
    self.start = function() {
        if (process.env.CLOUD) {
            console.log("skip push since this is in the cloud...");
            return;
        }
        console.log("[radio] watching for changes to database...");
        db.changes({
                live: true,
                since: 'now',
                include_docs: true
            })
            .on('active', function() {
                console.log("active change feed");
            })
            .on('paused', function() {
                console.log("paused change feed");
            })
            .on('change', onChange)
            .on('error', function (err) {
                console.log(err);
            });

        setInterval(notifyLanternOnline, ping);
    };
    

    /**
    * @todo stop listening for changes
    **/
    self.stop = function() {
        console.log("[radio] @todo implement stop");
    };
    


    //------------------------------------------------------------------------
    return self;
};