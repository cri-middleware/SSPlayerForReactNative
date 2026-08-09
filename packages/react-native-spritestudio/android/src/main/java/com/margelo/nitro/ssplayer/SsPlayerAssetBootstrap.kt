package com.margelo.nitro.ssplayer

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * Gets a `Context` to [SsPlayerAssets], and does nothing else.
 *
 * A content provider because it is the only startup hook this library can rely
 * on. The classes React Native constructs for us either get no context at all
 * (`getReactModuleInfoProvider`) or are called at a time nobody promises
 * (`createViewManagers` is resolved lazily under Fabric), and reading the APK's
 * assets has to work on the very first load. The manifest merger installs this
 * into every consuming app and Android instantiates it before
 * `Application.onCreate`, with no autolinking or app-side wiring involved.
 *
 * It deliberately does not load the native library — see [SsPlayerAssets].
 *
 * The query methods are unreachable: nothing knows the authority, and the
 * manifest marks it `android:exported="false"`.
 */
class SsPlayerAssetBootstrap : ContentProvider() {
  override fun onCreate(): Boolean {
    context?.let { SsPlayerAssets.remember(it) }
    return true
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ): Int = 0
}
