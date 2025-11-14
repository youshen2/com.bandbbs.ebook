import file from '@system.file' 

let storageCache = null;
const fileSavedPath = 'internal://files/books/storage-api/savedFile';

function loadIfNeeded(callback) {
    if (storageCache !== null) {
        callback(storageCache);
        return;
    }
    file.readText({
        uri: fileSavedPath,
        success: function(data) {
            try {
                storageCache = JSON.parse(data.text);
            } catch (e) {
                storageCache = {};
            }
            callback(storageCache);
        },
        fail: function() {
            storageCache = {};
            callback(storageCache);
        }
    });
}

function saveToFile() {
    if (storageCache !== null) {
        file.writeText({
            uri: fileSavedPath,
            text: JSON.stringify(storageCache)
        });
    }
}

function get(param){
    loadIfNeeded(data => {
        var str = data[param.key];
        if(str === undefined && param.default !== undefined){
            str = param.default;
        }
        if(str === undefined){
            str = '';
        }
        if(param.success){
            param.success(str);
        }
        if(param.complete){
            param.complete();
        }
    });
}

function save(data,param){
    storageCache = data;
    saveToFile();
    if(param.success){
        param.success();
    }
    if(param.complete){
        param.complete();
    }
}

function set(param){
    loadIfNeeded(data => {
        data[param.key] = param.value;
        saveToFile();
        if(param.success){
            param.success();
        }
        if(param.complete){
            param.complete();
        }
    });
}

function clear(param){
    storageCache = {};
    saveToFile();
    if (param && param.success) param.success();
    if (param && param.complete) param.complete();
}

function del(param){
    loadIfNeeded(data => {
        delete data[param.key];
        saveToFile();
        if(param.success) {
            param.success();
        }
        if(param.complete) {
            param.complete();
        }
    });
}

export default { get, set, clear, delete: del, save };
