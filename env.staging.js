// =============================================================
// AMBIENTE DE PRUEBAS — Supabase: planner-cbm-staging
// Reemplaza las credenciales de producción en app.js cuando
// este archivo se carga antes de app.js.
//
// ⚠️  NO usar en producción. Este archivo solo debe cargarse
//     en la rama feature/control-kits o entornos de staging.
// =============================================================
window._stagingConfig = {
    url: 'https://vppwlsoyweyzlqalaspy.supabase.co',
    key: 'sb_publishable_mGmInFHtFQh9NoPBwMUidw_h4wT23nJ'   // anon key del proyecto staging
};
window.IS_STAGING = true;
