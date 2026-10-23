// Synthetic, loopback-only visual fixture. Never import into production.
export function useAuth(){return {session:{access_token:'synthetic-preview-only'},profile:{role:'admin',is_active:true},aal:'aal2',loading:false,profileLoading:false};}
export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-preview-only'}},error:null})}};
