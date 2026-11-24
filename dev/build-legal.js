// Fills legal/*.body.html with legal/site-info.json and writes public/terms.html etc.
const fs=require('fs'),path=require('path');const root=path.join(__dirname,'..');
const info=JSON.parse(fs.readFileSync(path.join(root,'legal/site-info.json'),'utf8'));
info.DATE=new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
const base=fs.readFileSync(path.join(root,'legal/_base.html'),'utf8');
const pages={terms:'Terms & Conditions',privacy:'Privacy Policy',refund:'Refund & Cancellation Policy',shipping:'Delivery Policy',contact:'Contact Us'};
const fill=(t,v)=>t.replace(/\{\{(\w+)\}\}/g,(m,k)=>k in v?v[k]:m);
const bad=Object.entries(info).filter(([k,v])=>/CHANGE_ME/.test(v)).map(([k])=>k);
for(const [f,title] of Object.entries(pages)){
  const body=fill(fs.readFileSync(path.join(root,'legal',f+'.body.html'),'utf8'),info);
  fs.writeFileSync(path.join(root,'public',f+'.html'),fill(base,{...info,TITLE:title.replace(/&/g,'&amp;'),BODY:body}));
  console.log('wrote public/'+f+'.html');
}
if(bad.length){console.log('\n! Still to fill in legal/site-info.json: '+bad.join(', ')+'\n  Fill them, then run npm run legal again.');process.exit(1)}
console.log('\nAll details filled. Commit and push to publish.');