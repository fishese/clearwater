package com.fishese.clearwater;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.util.AtomicFile;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** User-selected SAF folders plus the app-private custom model slots. Existing SAF documents are never overwritten. */
@CapacitorPlugin(name = "ClearWaterFiles")
public class ClearWaterFilesPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Set<String> folders = new HashSet<>(), created = new HashSet<>(), captureCreated = new HashSet<>();
    private final Map<String, WriteSession> writes = new HashMap<>();
    private final Map<String, ModelWriteSession> modelWrites = new HashMap<>();
    private final Map<String, File> sharedFiles = new HashMap<>();
    private final List<JSObject> shares = new ArrayList<>();
    private String shareError;
    private static class WriteSession {
        final Uri uri; final OutputStream stream; final boolean mediaStore;
        WriteSession(Uri uri, OutputStream stream, boolean mediaStore) { this.uri=uri; this.stream=stream; this.mediaStore=mediaStore; }
    }
    private static class ModelWriteSession {
        final AtomicFile atomic; final File target; final FileOutputStream stream; final long expected; final String slot; long written;
        ModelWriteSession(AtomicFile atomic, File target, FileOutputStream stream, long expected, String slot) { this.atomic=atomic;this.target=target;this.stream=stream;this.expected=expected;this.slot=slot; }
    }
    private File modelFile(String slot) { return new File(getContext().getFilesDir(), "custom-model-"+slot+".onnx"); }
    private android.content.SharedPreferences modelPreferences() { return getContext().getSharedPreferences("clearwater-custom-model", android.content.Context.MODE_PRIVATE); }
    private JSONObject modelDescriptor() throws Exception {
        String value=modelPreferences().getString("descriptor",null);if(value==null)return null;
        JSONObject descriptor=new JSONObject(value);String sha=descriptor.optString("sha256"),name=descriptor.optString("name"),input=descriptor.optString("inputRange"),output=descriptor.optString("outputRange"),slot=descriptor.optString("slot");long size=descriptor.optLong("size",-1);
        if(!sha.matches("[a-f0-9]{64}")||name.isEmpty()||name.length()>255||!(input.equals("unit")||input.equals("signed"))||!(output.equals("unit")||output.equals("signed"))||!(slot.equals("a")||slot.equals("b"))||size<=0||size>64L*1024*1024)throw new IOException("Saved model settings are damaged.");
        return descriptor;
    }
    private JSONObject customConfig(JSONObject descriptor) throws Exception {
        JSONObject result=new JSONObject();result.put("sha256",descriptor.getString("sha256"));result.put("name",descriptor.getString("name"));result.put("inputRange",descriptor.getString("inputRange"));result.put("outputRange",descriptor.getString("outputRange"));return result;
    }
    @PluginMethod public void getRememberedModel(PluginCall call) { io.execute(()->{try {
        JSONObject descriptor=modelDescriptor();JSObject result=new JSObject();result.put("present",descriptor!=null);
        if(descriptor!=null){File file=modelFile(descriptor.getString("slot"));long size=descriptor.getLong("size");result.put("config",customConfig(descriptor));result.put("size",size);result.put("hasFile",file.isFile()&&file.length()==size);}
        else result.put("hasFile",false);
        call.resolve(result);
    }catch(Exception error){call.reject("Saved custom model settings are damaged.",error);}}); }
    @PluginMethod public void beginModelWrite(PluginCall call) { io.execute(()->{try {
        if(!modelWrites.isEmpty())throw new IOException("A custom model save is already in progress.");
        long size=call.getLong("size",-1L);if(size<=0||size>64L*1024*1024)throw new IOException("Custom model must be under 64 MB.");
        JSONObject old=modelDescriptor();String active=old==null?"b":old.getString("slot"),slot=active.equals("a")?"b":"a";
        File target=modelFile(slot);AtomicFile atomic=new AtomicFile(target);FileOutputStream stream=atomic.startWrite();String id=UUID.randomUUID().toString();modelWrites.put(id,new ModelWriteSession(atomic,target,stream,size,slot));JSObject result=new JSObject();result.put("id",id);call.resolve(result);
    }catch(Exception error){call.reject("Could not prepare private model storage.",error);}}); }
    @PluginMethod public void writeModelChunk(PluginCall call) { io.execute(()->{try {
        ModelWriteSession session=modelWrites.get(call.getString("id"));String data=call.getString("data");if(session==null||data==null||data.length()>350000)throw new IOException("Invalid model write session or chunk.");
        byte[] bytes=Base64.decode(data,Base64.NO_WRAP);if(bytes.length>262144||session.written+bytes.length>session.expected)throw new IOException("Invalid model size.");session.stream.write(bytes);session.written+=bytes.length;call.resolve();
    }catch(Exception error){call.reject("Could not save the custom model.",error);}}); }
    @PluginMethod public void finishModelWrite(PluginCall call) { io.execute(()->{
        String id=call.getString("id");ModelWriteSession session=modelWrites.remove(id);if(session==null){call.reject("Model write session is closed.");return;}
        if(call.getBoolean("abort",false)){try{session.atomic.failWrite(session.stream);}catch(Exception ignored){}call.resolve();return;}
        try {
            if(session.written!=session.expected)throw new IOException("Custom model is incomplete.");
            JSObject config=call.getObject("config");if(config==null)throw new IOException("Missing model settings.");
            String sha=config.getString("sha256"),name=config.getString("name"),input=config.getString("inputRange"),output=config.getString("outputRange");
            if(sha==null||!sha.matches("[a-f0-9]{64}")||name==null||name.isEmpty()||name.length()>255||!("unit".equals(input)||"signed".equals(input))||!("unit".equals(output)||"signed".equals(output)))throw new IOException("Invalid model settings.");
            session.atomic.finishWrite(session.stream);
            JSONObject descriptor=new JSONObject();descriptor.put("sha256",sha);descriptor.put("name",name);descriptor.put("inputRange",input);descriptor.put("outputRange",output);descriptor.put("slot",session.slot);descriptor.put("size",session.expected);
            String previous=modelPreferences().getString("descriptor",null);
            if(!modelPreferences().edit().putString("descriptor",descriptor.toString()).commit()){
                if(previous==null)modelPreferences().edit().remove("descriptor").commit();else modelPreferences().edit().putString("descriptor",previous).commit();
                session.target.delete();throw new IOException("Could not save model settings.");
            }
            call.resolve();
        }catch(Exception error){try{session.atomic.failWrite(session.stream);}catch(Exception ignored){}call.reject("Could not save the custom model.",error);}
    }); }
    @PluginMethod public void readModelChunk(PluginCall call) { io.execute(()->{try {
        JSONObject descriptor=modelDescriptor();if(descriptor==null)throw new IOException("No custom model is saved.");long size=descriptor.getLong("size"),offset=call.getLong("offset",-1L);int length=call.getInt("length",0);if(offset<0||offset>size||length<0||length>262144||offset+length>size)throw new IOException("Invalid model read range.");
        File file=modelFile(descriptor.getString("slot"));if(!file.isFile()||file.length()!=size)throw new FileNotFoundException("Saved custom model is missing.");byte[] bytes=new byte[length];try(RandomAccessFile input=new RandomAccessFile(file,"r")){input.seek(offset);input.readFully(bytes);}
        JSObject result=new JSObject();result.put("data",Base64.encodeToString(bytes,Base64.NO_WRAP));result.put("done",offset+length==size);call.resolve(result);
    }catch(Exception error){call.reject("Saved custom model is missing or damaged.",error);}}); }
    @PluginMethod public void clearRememberedModelFile(PluginCall call) { io.execute(()->{try {JSONObject descriptor=modelDescriptor();if(descriptor!=null&&!modelFile(descriptor.getString("slot")).delete()&&modelFile(descriptor.getString("slot")).exists())throw new IOException("Could not clear the saved model file.");call.resolve();}catch(Exception error){call.reject("Could not clear the saved model file.",error);}}); }
    @PluginMethod public void forgetRememberedModel(PluginCall call) { io.execute(()->{try {
        for(String slot:new String[]{"a","b"}){File file=modelFile(slot);if(file.exists()&&!file.delete())throw new IOException("Could not remove the saved model file.");}
        String previous=modelPreferences().getString("descriptor",null);
        if(!modelPreferences().edit().remove("descriptor").commit()){
            if(previous!=null)modelPreferences().edit().putString("descriptor",previous).commit();
            throw new IOException("Could not clear saved model settings.");
        }
        call.resolve();
    }catch(Exception error){call.reject("Could not remove the saved model.",error);}}); }
    @Override public void load() { enqueueShare(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { enqueueShare(intent); }
    @PluginMethod public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderSelected");
    }
    @ActivityCallback private void folderSelected(PluginCall call, ActivityResult result) {
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null) { call.reject("Folder selection cancelled.", "CANCELLED"); return; }
        Intent data=result.getData(); Uri tree=data.getData();
        io.execute(()->{try {
            int flags=data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0)throw new IOException("This folder is read only.");
            getContext().getContentResolver().takePersistableUriPermission(tree,flags);
            folders.add(tree.toString());
            Uri document=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            JSObject value=new JSObject(); value.put("uri",tree.toString());value.put("name",displayName(document,"Selected folder")); call.resolve(value);
        }catch(Exception error){call.reject("Could not access this folder.",error);}});
    }
    private Uri folder(PluginCall call) throws IOException {
        String value=call.getString("folder");
        if(value==null || !folders.contains(value))throw new IOException("Choose the folder again.");
        return Uri.parse(value);
    }
    private String filename(PluginCall call) throws IOException {
        String name=call.getString("name");
        if(name==null || name.isEmpty() || name.length()>240 || name.contains("/") || name.contains("\\") || name.equals(".") || name.equals(".."))throw new IOException("Invalid filename.");
        return name;
    }
    private JSObject find(Uri tree,String name) throws IOException {
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        try(Cursor cursor=getContext().getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)) {
            if(cursor==null)throw new IOException("Could not read this folder.");
            while(cursor.moveToNext())if(name.equalsIgnoreCase(cursor.getString(1))) {
                JSObject entry=new JSObject();entry.put("exists",true);if(!cursor.isNull(3))entry.put("size",cursor.getLong(3));entry.put("name",cursor.getString(1));entry.put("directory",DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2)));entry.put("uri",DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0)).toString());return entry;
            }
        }
        JSObject entry=new JSObject();entry.put("exists",false);return entry;
    }
    @PluginMethod public void stat(PluginCall call) { io.execute(()->{try{call.resolve(find(folder(call),filename(call)));}catch(Exception error){call.reject("Could not read this folder.",error);}}); }
    @PluginMethod public void listPhotos(PluginCall call) { io.execute(()->{try {
        Uri tree=folder(call),children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        JSArray photos=new JSArray();
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE};
        try(Cursor cursor=getContext().getContentResolver().query(children,columns,null,null,null)) {
            if(cursor==null)throw new IOException("Could not list this folder.");
            while(cursor.moveToNext()) {
                String name=cursor.getString(1),type=cursor.getString(2);long size=cursor.isNull(3)?-1:cursor.getLong(3);
                if(DocumentsContract.Document.MIME_TYPE_DIR.equals(type)||name==null||!name.toLowerCase(Locale.ROOT).matches(".*\\.(jpe?g|png|heic|heif|dng|mp4|mov)$")||size>512L*1024*1024)continue;
                JSObject photo=new JSObject();photo.put("uri",DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0)).toString());photo.put("name",name);photo.put("type",type==null?"image/jpeg":type);photo.put("size",size);photos.put(photo);
            }
        }
        JSObject result=new JSObject();result.put("photos",photos);call.resolve(result);
    }catch(Exception error){call.reject("Could not list photos in this folder.",error);}}); }
    @PluginMethod public void create(PluginCall call) { io.execute(()->{try {
        Uri tree=folder(call);String name=filename(call);
        if(Boolean.TRUE.equals(find(tree,name).getBool("exists")))throw new IOException("Filename already exists. Please save again.");
        Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        Uri document=DocumentsContract.createDocument(getContext().getContentResolver(),parent,name.toLowerCase(Locale.ROOT).endsWith(".png")?"image/png":name.toLowerCase(Locale.ROOT).endsWith(".json")?"application/json":name.toLowerCase(Locale.ROOT).endsWith(".mp4")?"video/mp4":"image/jpeg",name);
        if(document==null)throw new IOException("Could not create photo.");
        created.add(document.toString());JSObject value=new JSObject();value.put("uri",document.toString());value.put("name",displayName(document,name));call.resolve(value);
    }catch(Exception error){call.reject("Could not create a new photo.",error);}}); }
    @PluginMethod public void createCapture(PluginCall call) { io.execute(()->{Uri uri=null;try {
        String name=call.getString("name"),type=call.getString("type");
        if(name==null||name.isEmpty()||name.length()>240||name.contains("/")||name.contains("\\")||name.equals(".")||name.equals(".."))throw new IOException("Invalid capture filename.");
        boolean video="video/mp4".equals(type);
        if(!video&&!("image/jpeg".equals(type)))throw new IOException("Only JPEG photos and MP4 videos can be saved.");
        String expectedExtension=video?".mp4":".jpg";
        if(!name.toLowerCase(Locale.ROOT).endsWith(expectedExtension))throw new IOException("Capture filename does not match its media type.");
        String relative=video?Environment.DIRECTORY_MOVIES+"/ClearWater":Environment.DIRECTORY_PICTURES+"/ClearWater";
        if(Build.VERSION.SDK_INT>=29) {
            Uri collection=video?MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY):MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            try(Cursor cursor=getContext().getContentResolver().query(collection,new String[]{MediaStore.MediaColumns._ID},MediaStore.MediaColumns.DISPLAY_NAME+"=? AND "+MediaStore.MediaColumns.RELATIVE_PATH+"=?",new String[]{name,relative+"/"},null)) {
                if(cursor!=null&&cursor.moveToFirst())throw new IOException("Filename already exists. Please save again.");
            }
            ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);values.put(MediaStore.MediaColumns.MIME_TYPE,type);values.put(MediaStore.MediaColumns.RELATIVE_PATH,relative);values.put(MediaStore.MediaColumns.IS_PENDING,1);
            uri=getContext().getContentResolver().insert(collection,values);
            if(uri==null)throw new IOException("Could not create a gallery capture.");
            captureCreated.add(uri.toString());
            JSObject result=new JSObject();result.put("uri",uri.toString());result.put("name",name);result.put("destination",relative+"/"+name);call.resolve(result);return;
        }
        File base=getContext().getExternalFilesDir(video?Environment.DIRECTORY_MOVIES:Environment.DIRECTORY_PICTURES);
        if(base==null)base=getContext().getFilesDir();
        File directory=new File(base,"ClearWater");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Could not prepare app-specific capture storage.");
        File target=new File(directory,name);if(!target.createNewFile())throw new IOException("Filename already exists. Please save again.");
        uri=Uri.fromFile(target);captureCreated.add(uri.toString());
        JSObject result=new JSObject();result.put("uri",uri.toString());result.put("name",name);result.put("destination",target.getAbsolutePath());call.resolve(result);
    }catch(Exception error){if(uri!=null)deleteCapture(uri);call.reject("Could not create a camera capture.",error);}}); }
    @PluginMethod public void beginWrite(PluginCall call) { io.execute(()->{try {
        String value=call.getString("uri");boolean isCapture=captureCreated.remove(value);if(!isCapture&&!created.remove(value))throw new IOException("Only newly created photos can be written.");
        Uri uri=Uri.parse(value);boolean mediaStore=isCapture&&"content".equals(uri.getScheme());OutputStream stream;
        try {stream="file".equals(uri.getScheme())?new FileOutputStream(new File(uri.getPath()),false):getContext().getContentResolver().openOutputStream(uri,"wt");if(stream==null)throw new IOException("Could not open new photo.");}
        catch(Exception error){if(isCapture)deleteCapture(uri);else deleteDocument(uri);throw error;}
        String id=UUID.randomUUID().toString();writes.put(id,new WriteSession(uri,stream,mediaStore));JSObject result=new JSObject();result.put("id",id);call.resolve(result);
    }catch(Exception error){call.reject("Could not open new photo for writing.",error);}}); }
    @PluginMethod public void writeChunk(PluginCall call) { io.execute(()->{try {
        WriteSession session=writes.get(call.getString("id"));String data=call.getString("data");
        if(session==null || data==null || data.length()>350000)throw new IOException("Invalid write session or chunk.");
        session.stream.write(Base64.decode(data,Base64.NO_WRAP));call.resolve();
    }catch(Exception error){WriteSession session=writes.remove(call.getString("id"));if(session!=null)cleanupWrite(session);call.reject("Could not write photo.",error);}}); }
    @PluginMethod public void finishWrite(PluginCall call) { io.execute(()->{
        WriteSession session=writes.remove(call.getString("id"));if(session==null){call.reject("Write session is closed.");return;}
        boolean abort=call.getBoolean("abort",false);
        try {session.stream.close();if(abort)deleteWriteTarget(session);else if(session.mediaStore){ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.IS_PENDING,0);if(getContext().getContentResolver().update(session.uri,values,null,null)!=1)throw new IOException("Could not publish the gallery capture.");}call.resolve();}
        catch(Exception error){deleteWriteTarget(session);call.reject("Could not finish saving photo.",error);}
    }); }
    private void deleteDocument(Uri uri){try{DocumentsContract.deleteDocument(getContext().getContentResolver(),uri);}catch(Exception ignored){}}
    private void deleteCapture(Uri uri){try{if("content".equals(uri.getScheme()))getContext().getContentResolver().delete(uri,null,null);else if("file".equals(uri.getScheme()))new File(uri.getPath()).delete();}catch(Exception ignored){}}
    private void deleteWriteTarget(WriteSession session){if(session.mediaStore||"file".equals(session.uri.getScheme()))deleteCapture(session.uri);else deleteDocument(session.uri);}
    private void cleanupWrite(WriteSession session){try{session.stream.close();}catch(Exception ignored){}deleteWriteTarget(session);}
    private String displayName(Uri uri,String fallback) {
        try(Cursor cursor=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null && cursor.moveToFirst())return cursor.getString(0);}catch(Exception ignored){}return fallback;
    }
    @SuppressWarnings("deprecation") private void enqueueShare(Intent intent) {
        if(intent==null || !(Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())))return;
        List<Uri> uris=new ArrayList<>();
        if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())){ArrayList<Uri> items=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(items!=null)uris.addAll(items);}
        else {Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM);if(uri!=null)uris.add(uri);}
        if(uris.isEmpty() && intent.getClipData()!=null)for(int i=0;i<intent.getClipData().getItemCount();i++)uris.add(intent.getClipData().getItemAt(i).getUri());
        io.execute(()->{
            for(Uri uri:uris.subList(0,Math.min(uris.size(),50)))try{copyShare(uri);}catch(Exception error){shareError="Some shared files could not be imported. Maximum file size: 512 MB.";}
            notifyListeners("sharesAvailable",new JSObject(),true);
        });
    }
    private boolean isVideoName(String name) {return name.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|mov)$");}
    private void copyShare(Uri uri) throws IOException {
        if(uri==null || !"content".equals(uri.getScheme()))throw new IOException("Invalid shared photo.");
        String name=displayName(uri,"photo.jpg").replaceAll("[\\\\/\\p{Cntrl}]","_");
        String type=getContext().getContentResolver().getType(uri);
        if(!name.toLowerCase(Locale.ROOT).matches(".*\\.(jpe?g|png|heic|heif|dng|mp4|mov)$"))throw new IOException("Unsupported image.");
        String id=UUID.randomUUID().toString();File dir=new File(getContext().getCacheDir(),"shared-photos");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("No cache space.");
        File file=new File(dir,id);
        try(InputStream input=getContext().getContentResolver().openInputStream(uri);OutputStream output=new FileOutputStream(file)) {
            if(input==null)throw new IOException("Cannot read photo.");
            byte[] buffer=new byte[65536];long total=0;int count;
            while((count=input.read(buffer))!=-1){total+=count;if(total>512L*1024*1024)throw new IOException("Photo too large.");output.write(buffer,0,count);}
        }catch(Exception error){file.delete();throw new IOException(error);}
        sharedFiles.put(id,file);JSObject photo=new JSObject();photo.put("id",id);photo.put("path",file.getAbsolutePath());photo.put("name",name);photo.put("type",type==null?"image/jpeg":type);shares.add(photo);
    }
    @PluginMethod public void drainShares(PluginCall call) {io.execute(()->{JSObject result=new JSObject();result.put("photos",new JSArray(shares));shares.clear();if(shareError!=null){result.put("error",shareError);shareError=null;}call.resolve(result);});}
    @PluginMethod public void releaseShare(PluginCall call) {io.execute(()->{File file=sharedFiles.remove(call.getString("id"));if(file!=null)file.delete();call.resolve();});}
    @Override protected void handleOnDestroy() {io.execute(()->{for(WriteSession session:writes.values())cleanupWrite(session);writes.clear();for(String uri:captureCreated)deleteCapture(Uri.parse(uri));captureCreated.clear();for(ModelWriteSession session:modelWrites.values())try{session.atomic.failWrite(session.stream);}catch(Exception ignored){}modelWrites.clear();});io.shutdown();}
}
