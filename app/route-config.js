// Driving order for the dispatch run sheet.
// No device GPS. Positions come from job site addresses and the depot address.
//
// Default provider (no API key):
//   Geocoding — Nominatim (OpenStreetMap), https://nominatim.openstreetmap.org
//   Routing   — public OSRM demo, https://router.project-osrm.org
// Both accept browser requests from a static site. The OSRM demo is a shared
// server: this screen calls it when an admin asks for a suggestion, and job
// geocodes are cached on the job so addresses are not looked up again.
// Straight-line distance is never used as drive time or drive distance.
//
// Optional provider: OpenRouteService (https://openrouteservice.org).
// Set provider to "ors" and paste a key below. The key is shipped in this
// static app, so it is visible to anyone who can load the page. Leave it
// blank to stay on OSRM. A missing key, or an ORS error, falls back to OSRM
// and the suggestion says so.

export const routeConfig = {
  provider: "osrm",
  orsApiKey: "",
  nominatimUrl: "https://nominatim.openstreetmap.org/search",
  osrmUrl: "https://router.project-osrm.org",
  orsUrl: "https://api.openrouteservice.org",
};
