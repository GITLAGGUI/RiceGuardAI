import {createServer} from 'vite';
import {createReviewDatabase} from './review-database.mjs';
const db=await createReviewDatabase();await db.reset({reviewed:false,coordinates:false});
const vite=await createServer({server:{host:'127.0.0.1',port:5175,strictPort:true},plugins:[{name:'isolated-review-fixture',configureServer(server){server.middlewares.use('/__qa/review',async(req,res)=>{
 if(req.method!=='POST'){res.statusCode=405;res.end();return;}
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('Fixture payload too large');}const {action,payload}=JSON.parse(body);
 const result=action==='public-fixture'?(await db.pg.query('select * from rg_public_posts where slug=$1',[payload.slug])).rows[0]:await db.operation(action,payload);
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
 });}}]});
await vite.listen();console.log('Isolated QA: http://127.0.0.1:5175/qa/review-workflow.html');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await vite.close();await db.pg.close();process.exit(0);});
