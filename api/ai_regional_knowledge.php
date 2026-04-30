<?php
/**
 * Region II (Cagayan Valley) Pest & Disease Knowledge Base
 * Extracted from PRIME Pre-semester bulletins, DA Pest Risk info, and BPH guidelines.
 */

function riceguardGetRegionalKnowledge() {
    return <<<EOT
KNOWLEDGE BASE (REGION II - CAGAYAN VALLEY):
- Most Common Pests/Diseases (Based on PRIME Monitoring 2018-2023): Bacterial leaf blight, Bacterial leaf streak, Whitehead/Deadheart (Stemborer), Brown spot, Leaf blast, and Neck blast.
- Planting/Harvesting: 1st Semester (Dry Season) crop establishment is around Jan-Feb, harvested in March-April. 2nd Semester (Wet Season) vegetative stage is July-August, harvested Sept-Oct.

DISEASE & PEST GUIDELINES:
1. Bacterial Leaf Blight (BLB) & Bacterial Leaf Streak:
   - Caused by Xanthomonas oryzae pv. Oryzae. Reduces photosynthetic area, 20-50% yield loss.
   - Management: Avoid excessive nitrogen, apply in splits. Apply potassium. Improve drainage. Avoid antibiotics as local strains are resistant. Avoid ratooning. Copper fungicides as last resort but with caution.

2. Rice Blast (Leaf & Neck Blast):
   - Caused by fungus Magnaporthe oryzae. Airborne and seed-borne. Favored by water scarcity, high night humidity, low night temp.
   - Management: Resistant varieties. Optimum seeding rate (80kg/ha) to avoid dense canopy. Manage nitrogen. Irrigate continuously until 1 week before harvest (drought stress favors blast). Fungicides (e.g. azoxystrobin) as last resort.

3. Stemborer (Deadheart/Whitehead):
   - Management: Synchronized planting. Raise irrigation water to submerge eggs. Avoid early insecticide application. Systemic insecticides after vegetative stage only if severe. Cut stubbles close to ground.

4. Brown Spot:
   - Associated with Akiochi (nutritional disorder/excessive hydrogen sulfide).
   - Management: Improve soil fertility. Clean seeds via flotation. Keep field continuously irrigated (drought favors brown spot). Apply potassium.

5. Brown Planthopper (BPH) / Hopperburn:
   - Sucks sap at base of tillers causing yellowing/drying (hopperburn). Transmits ragged stunt and grassy stunt viruses.
   - Biology & Management (from IRRI/DA): Avoid excessive nitrogen and dense planting. Encourage natural enemies (spiders, wasps). If spraying is necessary, aim at the base of the plant where BPH stay.

6. Tungro & Green Leafhopper (GLH):
   - Caused by RTBV and RTSV viruses transmitted by GLH. 
   - Management: Rogue infected plants. Synchronized planting.

7. Rats:
   - Can cause 5-100% loss. Most destructive at grain maturity.

8. Weeds:
   - Apply stale seedbed technique. Maintain 2-5cm water level to suppress weeds.
EOT;
}
