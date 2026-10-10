// Paste the web-app config from Firebase console > Project settings > Your apps (see SETUP.md).
// These values are NOT secrets (security comes from Auth + firestore.rules), so committing them is fine.
export const firebaseConfig = {
  apiKey: "AIzaSyBFtHi3ms9hqOq48k_nW3k_ThCvQqXrn-Q",
  authDomain: "heartwood-9f37f.firebaseapp.com",
  projectId: "heartwood-9f37f",
  storageBucket: "heartwood-9f37f.firebasestorage.app",
  messagingSenderId: "414325106644",
  appId: "1:414325106644:web:0163e3ccfe965dd6fa9841",
};
// Local testing: open the app with ?emu=1 (or on localhost) to use the Firebase Emulator Suite.
export const useEmulator = location.hostname === "localhost" || location.hostname === "127.0.0.1" || new URLSearchParams(location.search).has("emu");
// Firebase Storage photos are NOT used (needs Blaze); photos are emailed instead. Kept false; see dormant_storage/.
export const photosEnabled = false;
