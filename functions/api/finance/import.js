// The Pages CMS GitHub Action can register opted-in cards without using admin cookies.
// Requires a dedicated FINANCE_SYNC_TOKEN (same value in GitHub Actions and Cloudflare).
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers});
export async function onRequestPost({request,env}) {
  const token=env.FINANCE_SYNC_TOKEN||"";
  const authorization=request.headers.get("Authorization")||"";
  if(typeof token!=="string"||token.length<32||authorization!=="Bearer "+token)
    return json({success:false,error:"Not authorized or sync token is not configured."},401);
  if(!env.DB)return json({success:false,error:"D1 is not configured."},503);
  const length=Number(request.headers.get("Content-Length")||0);
  if(!Number.isFinite(length)||length>140000)
    return json({success:false,error:"Request is too large."},413);
  try {
    const body=await request.json();
    const input=body?.products;
    if(!Array.isArray(input)||!input.length||input.length>500)
      return json({success:false,error:"Expected products array."},400);
    const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const slugPattern=/^[a-z0-9][a-z0-9_-]*$/;
    const seenIds=new Set(),seenSlugs=new Set(),rows=[];
    for(const p of input){
      const id=String(p.product_id||"").toLowerCase(),slug=String(p.slug||"").trim(),
        title=String(p.title||"").trim(),price=Number(p.price||0);
      if(!idPattern.test(id)||!slugPattern.test(slug)||slug.length>300||
         !title||title.length>400||!Number.isSafeInteger(price)||price<0||price>100000000||seenIds.has(id)||seenSlugs.has(slug))
        return json({success:false,error:"Duplicate or invalid product ID/slug/title."},400);
      seenIds.add(id);seenSlugs.add(slug);rows.push([id,slug,title,price]);
    }
    const result=await env.DB.prepare(
      "INSERT INTO finance_products (product_id,product_slug,title,list_price) "+
      "SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') "+
      "FROM json_each(?) WHERE 1 "+
      "ON CONFLICT(product_id) DO UPDATE SET product_slug=excluded.product_slug,"+
      "title=excluded.title,list_price=excluded.list_price,updated_at=CURRENT_TIMESTAMP"
    ).bind(JSON.stringify(rows)).run();
    return json({success:true,count:rows.length,changed:Number(result.meta?.changes||0)});
  }catch(error){
    console.error("Finance import failed",error);
    return json({success:false,error:"Finance import failed; check D1 migration."},500);
  }
}
