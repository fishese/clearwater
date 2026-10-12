package com.fishese.clearwater;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** User-selected SAF folders only. Existing documents are never opened for writing. */
@CapacitorPlugin(name = "ClearWaterFiles")
public class ClearWaterFilesPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Set<String> folders = new HashSet<>(), created = new HashSet<>();
    private final Map<String, WriteSession> writes = new HashMap<>();
    private final Map<String, File> sharedFiles = new HashMap<>();
    private final List<JSObject> shares = new ArrayList<>();
    private String shareError;
    private static class WriteSession {
        final Uri uri; final OutputStream stream;
        WriteSession(Uri uri, OutputStream stream) { this.uri=uri; this.stream=stream; }
    }
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
        try(Cursor cursor=getContext().getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
            if(cursor==null)throw new IOException("Could not read this folder.");
            while(cursor.moveToNext())if(name.equalsIgnoreCase(cursor.getString(1))) {
                JSObject entry=new JSObject();entry.put("exists",true);entry.put("name",cursor.getString(1));entry.put("directory",DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2)));entry.put("uri",DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0)).toString());return entry;
            }
        }
        JSObject entry=new JSObject();entry.put("exists",false);return entry;
    }
    @PluginMethod public void stat(PluginCall call) { io.execute(()->{try{call.resolve(find(folder(call),filename(call)));}catch(Exception error){call.reject("Could not read this folder.",error);}}); }
    @PluginMethod public void create(PluginCall call) { io.execute(()->{try {
        Uri tree=folder(call);String name=filename(call);
        if(Boolean.TRUE.equals(find(tree,name).getBool("exists")))throw new IOException("Filename already exists. Please save again.");
        Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        Uri document=DocumentsContract.createDocument(getContext().getContentResolver(),parent,name.toLowerCase(Locale.ROOT).endsWith(".png")?"image/png":name.toLowerCase(Locale.ROOT).endsWith(".json")?"application/json":"image/jpeg",name);
        if(document==null)throw new IOException("Could not create photo.");
        created.add(document.toString());JSObject value=new JSObject();value.put("uri",document.toString());value.put("name",displayName(document,name));call.resolve(value);
    }catch(Exception error){call.reject("Could not create a new photo.",error);}}); }
    @PluginMethod public void beginWrite(PluginCall call) { io.execute(()->{try {
        String value=call.getString("uri");if(!created.remove(value))throw new IOException("Only newly created photos can be written.");
        Uri uri=Uri.parse(value);OutputStream stream;
        try {stream=getContext().getContentResolver().openOutputStream(uri,"wt");if(stream==null)throw new IOException("Could not open new photo.");}
        catch(Exception error){DocumentsContract.deleteDocument(getContext().getContentResolver(),uri);throw error;}
        String id=UUID.randomUUID().toString();writes.put(id,new WriteSession(uri,stream));JSObject result=new JSObject();result.put("id",id);call.resolve(result);
    }catch(Exception error){call.reject("Could not open new photo for writing.",error);}}); }
    @PluginMethod public void writeChunk(PluginCall call) { io.execute(()->{try {
        WriteSession session=writes.get(call.getString("id"));String data=call.getString("data");
        if(session==null || data==null || data.length()>350000)throw new IOException("Invalid write session or chunk.");
        session.stream.write(Base64.decode(data,Base64.NO_WRAP));call.resolve();
    }catch(Exception error){call.reject("Could not write photo.",error);}}); }
    @PluginMethod public void finishWrite(PluginCall call) { io.execute(()->{
        WriteSession session=writes.remove(call.getString("id"));if(session==null){call.reject("Write session is closed.");return;}
        boolean abort=call.getBoolean("abort",false);
        try {session.stream.close();if(abort)DocumentsContract.deleteDocument(getContext().getContentResolver(),session.uri);call.resolve();}
        catch(Exception error){try{DocumentsContract.deleteDocument(getContext().getContentResolver(),session.uri);}catch(Exception ignored){}call.reject("Could not finish saving photo.",error);}
    }); }
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
            for(Uri uri:uris.subList(0,Math.min(uris.size(),50)))try{copyShare(uri);}catch(Exception error){shareError="Some shared photos could not be imported. Choose JPEG, PNG or HEIC files under 60 MB.";}
            notifyListeners("sharesAvailable",new JSObject(),true);
        });
    }
    private void copyShare(Uri uri) throws IOException {
        if(uri==null || !"content".equals(uri.getScheme()))throw new IOException("Invalid shared photo.");
        String name=displayName(uri,"photo.jpg").replaceAll("[\\\\/\\p{Cntrl}]","_");
        String type=getContext().getContentResolver().getType(uri);
        if(!name.toLowerCase(Locale.ROOT).matches(".*\\.(jpe?g|png|heic|heif)$"))throw new IOException("Unsupported image.");
        String id=UUID.randomUUID().toString();File dir=new File(getContext().getCacheDir(),"shared-photos");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("No cache space.");
        File file=new File(dir,id);
        try(InputStream input=getContext().getContentResolver().openInputStream(uri);OutputStream output=new FileOutputStream(file)) {
            if(input==null)throw new IOException("Cannot read photo.");
            byte[] buffer=new byte[65536];long total=0;int count;
            while((count=input.read(buffer))!=-1){total+=count;if(total>60L*1024*1024)throw new IOException("Photo too large.");output.write(buffer,0,count);}
        }catch(Exception error){file.delete();throw new IOException(error);}
        sharedFiles.put(id,file);JSObject photo=new JSObject();photo.put("id",id);photo.put("path",file.getAbsolutePath());photo.put("name",name);photo.put("type",type==null?"image/jpeg":type);shares.add(photo);
    }
    @PluginMethod public void drainShares(PluginCall call) {io.execute(()->{JSObject result=new JSObject();result.put("photos",new JSArray(shares));shares.clear();if(shareError!=null){result.put("error",shareError);shareError=null;}call.resolve(result);});}
    @PluginMethod public void releaseShare(PluginCall call) {io.execute(()->{File file=sharedFiles.remove(call.getString("id"));if(file!=null)file.delete();call.resolve();});}
    @Override protected void handleOnDestroy() {io.execute(()->{for(WriteSession session:writes.values()){try{session.stream.close();DocumentsContract.deleteDocument(getContext().getContentResolver(),session.uri);}catch(Exception ignored){}}writes.clear();});io.shutdown();}
}
