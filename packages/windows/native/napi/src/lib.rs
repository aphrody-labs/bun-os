// SPDX-License-Identifier: Apache-2.0
//! WinRT provider of `@aphrody/windows`. Read-only Windows Runtime calls through windows-rs.
#![cfg(windows)]

use napi::{Error, Result};
use napi_derive::napi;
use std::sync::Once;
use windows::{
  Foundation::Uri,
  Storage::StorageFolder,
  System::Profile::AnalyticsInfo,
  Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize},
  core::HSTRING,
};

fn init() {
  static ONCE: Once = Once::new();
  // S_FALSE and RPC_E_CHANGED_MODE both mean the thread already has an apartment; either is fine here.
  ONCE.call_once(|| unsafe {
    let _ = RoInitialize(RO_INIT_MULTITHREADED);
  });
}

fn fail(error: windows::core::Error) -> Error {
  Error::from_reason(format!("ERR_WINDOWS_HRESULT 0x{:08X}: {}", error.code().0 as u32, error.message()))
}

#[napi(object)]
pub struct UriParts {
  pub scheme: String,
  pub host: String,
  pub port: i32,
  pub path: String,
  pub query: String,
  pub fragment: String,
  pub absolute: String,
}

/// Windows.Foundation.Uri.CreateUri.
#[napi]
pub fn winrt_uri_parse(url: String) -> Result<UriParts> {
  init();
  let uri = Uri::CreateUri(&HSTRING::from(url)).map_err(fail)?;
  let text = |value: windows::core::Result<HSTRING>| value.map(|v| v.to_string()).map_err(fail);
  Ok(UriParts {
    scheme: text(uri.SchemeName())?,
    host: text(uri.Host())?,
    port: uri.Port().map_err(fail)?,
    path: text(uri.Path())?,
    query: text(uri.Query())?,
    fragment: text(uri.Fragment())?,
    absolute: text(uri.AbsoluteUri())?,
  })
}

#[napi(object)]
pub struct FolderInfo {
  pub name: String,
  pub display_name: String,
  pub path: String,
  /// DateCreated as milliseconds since the Unix epoch.
  pub created_ms: f64,
}

/// Windows.Storage.StorageFolder.GetFolderFromPathAsync, awaited on the calling thread.
#[napi]
pub fn winrt_folder_info(path: String) -> Result<FolderInfo> {
  init();
  let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(path)).map_err(fail)?.join().map_err(fail)?;
  // DateTime counts 100 ns ticks since 1601-01-01; the Unix epoch is 11644473600 s later.
  let ticks = folder.DateCreated().map_err(fail)?.UniversalTime;
  Ok(FolderInfo {
    name: folder.Name().map_err(fail)?.to_string(),
    display_name: folder.DisplayName().map_err(fail)?.to_string(),
    path: folder.Path().map_err(fail)?.to_string(),
    created_ms: (ticks as f64) / 10_000.0 - 11_644_473_600_000.0,
  })
}

/// Windows.System.Profile.AnalyticsInfo.VersionInfo: DeviceFamily such as "Windows.Desktop".
#[napi]
pub fn winrt_device_family() -> Result<String> {
  init();
  AnalyticsInfo::VersionInfo().map_err(fail)?.DeviceFamily().map(|v| v.to_string()).map_err(fail)
}

/// Crate version, so the facade can tell which provider build it loaded.
#[napi]
pub fn provider_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
