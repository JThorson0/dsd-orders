// ============================================================
//  FIREBASE CONFIG — DSD Orders (Justin's project)
//  Filled in 2026-09-15. If you ever rotate keys, update the
//  values below; everything else stays the same.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBOucZz1Z1Ja0g2MVAZdMKjCuuCaccho5c",
  authDomain: "dsd-orders.firebaseapp.com",
  projectId: "dsd-orders",
  storageBucket: "dsd-orders.firebasestorage.app",
  messagingSenderId: "846324902165",
  appId: "1:846324902165:web:46f5f154c4299151a7611c",
};

export const FIREBASE_SDK_VERSION = "10.12.2";

export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey !== "PASTE" &&
    firebaseConfig.projectId !== "PASTE" &&
    firebaseConfig.authDomain !== "PASTE"
  );
}
