//! Where a link in the CallUp window is allowed to go.
//! The live app stays in the window. Stripe, maps and mail open in the system browser.
//! Print previews and Firebase auth stay in the window so blob URLs and the reset page work.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use url::Url;

pub const LIVE_APP_URL: &str = "https://app.callupapp.com.au/app/";

const APP_HOSTS: &[&str] = &["app.callupapp.com.au", "jobs.heartwoodew.com"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Destination {
    /// Load this URL in the CallUp window (or a window it opened).
    InApp,
    /// Open the system browser or mail client, and do not navigate the CallUp window.
    External,
    /// Drop the navigation. Used for schemes such as javascript:.
    Ignore,
}

pub fn classify(url: &Url) -> Destination {
    match url.scheme() {
        "mailto" | "tel" | "sms" => Destination::External,
        "blob" | "data" | "about" => Destination::InApp,
        "https" => classify_https(url),
        "http" => Destination::External,
        _ => Destination::Ignore,
    }
}

fn classify_https(url: &Url) -> Destination {
    let Some(host) = url.host_str() else {
        return Destination::Ignore;
    };
    let host = host.to_ascii_lowercase();
    let path = url.path();
    if APP_HOSTS.contains(&host.as_str()) || auth_host(&host) || storage_host(&host) || google_helper(&host, path) {
        return Destination::InApp;
    }
    Destination::External
}

fn auth_host(host: &str) -> bool {
    host_is(host, "firebaseapp.com")
        || host_is(host, "web.app")
        || host_is(host, "googleapis.com")
        || host_is(host, "gstatic.com")
        || host == "accounts.google.com"
        || host == "accounts.youtube.com"
        || host == "apis.google.com"
}

fn storage_host(host: &str) -> bool {
    host == "firebasestorage.googleapis.com" || host_is(host, "firebasestorage.app")
}

fn google_helper(host: &str, path: &str) -> bool {
    // Firebase Auth may open a recaptcha frame. A maps link on the same host is a user destination.
    if host == "www.google.com" && path.starts_with("/recaptcha") {
        return true;
    }
    host == "recaptcha.google.com" || host == "www.recaptcha.net" || host_is(host, "recaptcha.net")
}

fn host_is(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

pub fn downloads_dir() -> Option<PathBuf> {
    if let Some(dir) = env_dir("USERPROFILE") {
        return Some(dir);
    }
    env_dir("HOME")
}

fn env_dir(key: &str) -> Option<PathBuf> {
    let base = std::env::var_os(key)?;
    let dir = PathBuf::from(base).join("Downloads");
    dir.is_dir().then_some(dir)
}

pub fn place_download(suggested: &Path, downloads: &Path) -> PathBuf {
    let name = safe_name(suggested.file_name());
    let direct = downloads.join(&name);
    if !direct.exists() {
        return direct;
    }
    let path = Path::new(&name);
    let stem = path.file_stem().unwrap_or(OsStr::new("CallUp-download"));
    let ext = path.extension();
    for n in 2..1000 {
        let mut candidate = OsString::from(format!("{} ({n})", stem.to_string_lossy()));
        if let Some(ext) = ext {
            candidate.push(".");
            candidate.push(ext);
        }
        let path = downloads.join(&candidate);
        if !path.exists() {
            return path;
        }
    }
    direct
}

fn safe_name(name: Option<&OsStr>) -> OsString {
    let Some(name) = name else {
        return OsString::from("CallUp-download");
    };
    let text = name.to_string_lossy();
    if text.is_empty() || text == "." || text == ".." || text.contains(['/', '\\', ':']) {
        return OsString::from("CallUp-download");
    }
    OsString::from(text.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).expect(value)
    }

    #[test]
    fn callup_and_auth_stay_in_the_window() {
        assert_eq!(classify(&url("https://app.callupapp.com.au/app/")), Destination::InApp);
        assert_eq!(classify(&url("https://app.callupapp.com.au/app/?invite=abc")), Destination::InApp);
        assert_eq!(classify(&url("https://APP.CALLUPAPP.COM.AU/app/")), Destination::InApp);
        assert_eq!(classify(&url("https://jobs.heartwoodew.com/app/")), Destination::InApp);
        assert_eq!(
            classify(&url("https://heartwood-9f37f.firebaseapp.com/__/auth/action?mode=resetPassword")),
            Destination::InApp
        );
        assert_eq!(classify(&url("https://accounts.google.com/o/oauth2/v2/auth")), Destination::InApp);
        assert_eq!(classify(&url("https://www.google.com/recaptcha/api2/anchor")), Destination::InApp);
        assert_eq!(classify(&url("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js")), Destination::InApp);
        assert_eq!(classify(&url("blob:https://app.callupapp.com.au/8b0b0b0b-0000-4000-8000-000000000000")), Destination::InApp);
        assert_eq!(classify(&url("about:blank")), Destination::InApp);
    }

    #[test]
    fn stripe_maps_and_mail_leave_the_window() {
        assert_eq!(classify(&url("https://checkout.stripe.com/c/pay/cs_test_123")), Destination::External);
        assert_eq!(classify(&url("https://billing.stripe.com/p/session/test")), Destination::External);
        assert_eq!(classify(&url("https://www.google.com/maps/search/?api=1&query=Chuwar")), Destination::External);
        assert_eq!(classify(&url("https://maps.google.com/?q=Chuwar")), Destination::External);
        assert_eq!(classify(&url("mailto:accounts@example.com?subject=Hours")), Destination::External);
        assert_eq!(classify(&url("https://app.callupapp.com.au.evil.example/app/")), Destination::External);
        assert_eq!(classify(&url("https://evil.example/")), Destination::External);
        assert_eq!(classify(&url("http://app.callupapp.com.au/app/")), Destination::External);
        assert_eq!(classify(&url("javascript:alert(1)")), Destination::Ignore);
    }

    #[test]
    fn downloads_use_the_suggested_name_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("callup-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = place_download(Path::new("hours.csv"), &dir);
        assert_eq!(first, dir.join("hours.csv"));
        std::fs::write(&first, "a").unwrap();
        let second = place_download(Path::new("/tmp/nested/hours.csv"), &dir);
        assert_eq!(second, dir.join("hours (2).csv"));
        assert_eq!(place_download(Path::new(".."), &dir), dir.join("CallUp-download"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
