import file from '@system.file' 

var storageFile = {}
const fileSavedPath = 'internal://files/books/storage-api/savedFile'

storageFile.get = function(param){
    
    var func = function(data){
        var str = data[param.key];
        if(!str && param.default){
            str = param.default;
        }
        if(!str){
            str = '';
        }
        if(param.success){
            param.success(str);
        }
        if(param.complete){
            param.complete();
        }
    }
    
    file.readText({
      uri: fileSavedPath,
      success: function(data) {
        // 
        func(JSON.parse(data.text))
      },
      fail: function(data, code) {
        // 
        func({})
      }
    })
}

storageFile.save = function(data,param){
    file.writeText({
      uri: fileSavedPath,
      text: JSON.stringify(data),
      success: function() {
        // 
        // 
        if(param.success){
            param.success();
        }
        if(param.complete){
            param.complete();
        }
      },
      fail: function(data, code) {
        // console.log(`handling fail, code = ${code}`)
        if(param.fail){
            param.fail(data, code);
        }
        if(param.complete){
            param.complete();
        }
      }
    })
}

storageFile.set = function(param){
    var func = function(data){
        data[param.key] = param.value;
        storageFile.save(data,param);
    }
    
    file.readText({
      uri: fileSavedPath,
      success: function(data) {
        // 
        func(JSON.parse(data.text))
      },
      fail: function(data, code) {
        // 
        func({})
      }
    })
}

storageFile.clear = function(param){
    var data = {};
    storageFile.save(data,param);
}

storageFile.delete = function(param){
    var func = function(data){
        delete data[param.key];
        storageFile.save(data,param);
    }
    file.readText({
      uri: fileSavedPath,
      success: function(data) {
        // 
        func(JSON.parse(data.text))
      },
      fail: function(data, code) {
        // 
        func({})
      }
    })
}

// var storage = storageFile
export default storageFile
