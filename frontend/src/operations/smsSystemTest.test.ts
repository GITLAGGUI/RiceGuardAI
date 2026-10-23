import { describe,expect,it } from "vitest";
import { SYSTEM_TEST_MESSAGE,validateSystemTest } from "../../../supabase/functions/_shared/smsSystemTest";
describe("bounded SMS connection test",()=>{
  const now=1000,expiry=new Date(2000).toISOString();
  it("accepts only the approved contacts",()=>expect(validateSystemTest(["joel","jaquilyn"],["joel","jaquilyn"],expiry,now)).toEqual(["joel","jaquilyn"]));
  it.each([[],["other"],["joel","joel"],["joel","jaquilyn","other"]])("rejects an unapproved audience %j",(...ids)=>expect(()=>validateSystemTest(ids,["joel","jaquilyn"],expiry,now)).toThrow());
  it("rejects expired or missing approval",()=>{expect(()=>validateSystemTest(["joel"],["joel"],expiry,2000)).toThrow();expect(()=>validateSystemTest(["joel"],["joel"],undefined,now)).toThrow();});
  it("is one plain-text SMS and never an agricultural recommendation",()=>{expect(SYSTEM_TEST_MESSAGE.length).toBeLessThan(160);expect(SYSTEM_TEST_MESSAGE).toContain("not a farm advisory");expect(SYSTEM_TEST_MESSAGE).toMatch(/^[\x20-\x7e]+$/);});
});
