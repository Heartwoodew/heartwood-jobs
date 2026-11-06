// Live deploy is disabled on this branch.
// Storage rules, Firestore rules, Cloud Functions, Cloud Scheduler and
// lifecycle policies must not be published until the owner completes the
// steps in cloud/MIGRATION.md. This script is the firebase predeploy hook.
console.error("Live Firebase deploy is disabled. See cloud/MIGRATION.md. Nothing was deployed.");
process.exit(1);
