// =============================================================
// AMBIENTE DE PRUEBAS — Supabase: planner-cbm-staging
// Reemplaza las credenciales de producción en app.js cuando
// este archivo se carga antes de app.js.
//
// ⚠️  NO usar en producción. Este archivo solo debe cargarse
//     en la rama feature/control-kits o entornos de staging.
// =============================================================
window._stagingConfig = {
    url: 'REEMPLAZAR_CON_URL_DE_STAGING',       // ej. https://xxxx.supabase.co
    key: 'REEMPLAZAR_CON_ANON_KEY_DE_STAGING'   // anon key del proyecto staging
};
window.IS_STAGING = true;
