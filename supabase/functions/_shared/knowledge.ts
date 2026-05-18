// Structured agronomy knowledge base for the three target rice diseases.
// Sources: PhilRice PalayCheck (2022), DA Region II Integrated Crop Management
// Guidelines, IRRI Rice Knowledge Bank. Content is hand-curated Tagalog/Taglish
// for smallholder farmers — keep imperative voice, short sentences, no jargon.

export type Disease = "rice_blast" | "bacterial_leaf_blight" | "tungro";
export type Severity = "low" | "medium" | "high";

interface DiseaseProfile {
  /** Canonical Tagalog name shown to farmers */
  name_tl: string;
  /** English scientific name */
  name_en: string;
  /** Pathogen / vector */
  cause: string;
  /** Visual symptoms in farmer language */
  symptoms_tl: string[];
  /** Environmental conditions that favor the disease */
  conditions: string;
  /** Recommended chemicals (PhilRice-aligned) with active ingredient + dose */
  chemicals: Array<{ ai: string; product_examples: string; dose: string; note?: string }>;
  /** Cultural / non-chemical practices */
  cultural: string[];
  /** Resistant varieties (NSIC Rc series) */
  resistant_varieties: string[];
  /** Per-severity action plan in Tagalog */
  severity_actions: Record<Severity, string[]>;
}

export const KB: Record<Disease, DiseaseProfile> = {
  rice_blast: {
    name_tl: "Sakit na Blast",
    name_en: "Rice Blast",
    cause: "Magnaporthe oryzae (fungus)",
    symptoms_tl: [
      "Spindle-shaped na lesion sa dahon — kayumanggi sa gilid, kulay-abo sa gitna",
      "Madilim na node lesion na pwedeng pumutol ng tangkay",
      "Kumukupas na panicle (neck blast) — bulok at hindi nabubuo ang butil",
    ],
    conditions:
      "Mataas na halumigmig (>85%), temperatura 22–28°C, malakas na hamog, sobrang nitrogen.",
    chemicals: [
      {
        ai: "Tricyclazole 75% WP",
        product_examples: "Beam, Tricyclazole 75",
        dose: "0.6 g / L tubig (300 g / hectare)",
        note: "Preventive, lalong epektibo kapag spray bago lumala",
      },
      {
        ai: "Azoxystrobin 250 SC",
        product_examples: "Amistar",
        dose: "1 mL / L tubig",
        note: "Curative + systemic, alternate sa Tricyclazole para iwasan ang resistance",
      },
      {
        ai: "Difenoconazole + Propiconazole",
        product_examples: "Armure",
        dose: "1 mL / L tubig",
      },
    ],
    cultural: [
      "Bawasan ang nitrogen fertilizer (huwag lumagpas sa 90 kg/ha sa unang split)",
      "I-drain ang field kapag mainit ng tanghali; iwasan ang continuous flooding",
      "Linisin ang stubble at infected ratoons bago muling magtanim",
      "Spaced planting (20×20 cm) para may air circulation",
    ],
    resistant_varieties: ["NSIC Rc222", "NSIC Rc218", "NSIC Rc480"],
    severity_actions: {
      low: [
        "Mag-monitor tuwing 3 araw — ilan lang ang naapektuhang dahon.",
        "Huwag pa mag-spray. Bawasan muna ang nitrogen at mag-drain ng field.",
        "Mag-record ng oras at lokasyon ng naunang nakitang lesion.",
      ],
      medium: [
        "Mag-spray ng Tricyclazole 75 WP (0.6 g/L) sa mga apektadong bahagi sa loob ng 24 oras.",
        "I-drain ang field, iwasan ang flooding ng 5–7 araw.",
        "I-inspect tuwing 2 araw — kung dumadami ang lesion, ulitin ang spray pagkalipas ng 7 araw.",
        "Huwag mag-apply ng nitrogen sa susunod na linggo.",
      ],
      high: [
        "URGENT: I-spray AGAD ang buong infected zone gamit ang Tricyclazole o Azoxystrobin (alternating).",
        "I-isolate ang naapektuhang plot — huwag dadaanan papuntang malinis na bahagi.",
        "Tawagan ang barangay extension worker o LGU agriculturist para sa community-level response.",
        "Tingnan ang katabing palayan — pwedeng kumalat sa loob ng 3–5 araw.",
        "Wala munang fertilizer hanggang ma-control ang outbreak.",
      ],
    },
  },

  bacterial_leaf_blight: {
    name_tl: "Bacterial Leaf Blight (BLB)",
    name_en: "Bacterial Leaf Blight",
    cause: "Xanthomonas oryzae pv. oryzae (bacteria)",
    symptoms_tl: [
      "Yellow streak na nagsisimula sa dulo o gilid ng dahon",
      "Lumalaking water-soaked lesion na sa wakas ay nagiging dilaw at tuyot",
      "Kresek phase — biglaang pagkalanta ng buong halaman (sa puno ng panahon)",
    ],
    conditions:
      "Mainit + maulan (28–34°C), malakas na hangin, mataas na nitrogen, deep flooding, may sugat sa dahon.",
    chemicals: [
      {
        ai: "Copper hydroxide 77% WP",
        product_examples: "Kocide 3000, Funguran",
        dose: "3 g / L tubig (1.5 kg / hectare)",
        note: "Pinaka-epektibo bilang preventive; hindi gumagaling ang infected tissue",
      },
      {
        ai: "Copper oxychloride 50% WP",
        product_examples: "Cuprocaffaro",
        dose: "3 g / L tubig",
      },
    ],
    cultural: [
      "Iwasan ang pag-spray ng nitrogen kapag may BLB outbreak (huwag lumagpas sa 60 kg/ha)",
      "Iwasan ang deep flooding (panatilihing 3–5 cm lang ang tubig)",
      "I-rogue (alisin at sunugin) ang infected ratoons + ligaw na palay",
      "Linisin ang gulungan/tabas ng tubig para hindi makapasok ang bacteria",
      "Iwasang dumaan sa basang palayan — kumakalat ang bacteria sa damit at sapatos",
    ],
    resistant_varieties: ["NSIC Rc154", "NSIC Rc222", "NSIC Rc480", "NSIC Rc23"],
    severity_actions: {
      low: [
        "Mag-spot inspection sa kabuuan ng bukid — mag-mark ng mga apektadong hill.",
        "I-rogue ang ilang infected hills habang konti pa.",
        "Bawasan ang fertilizer. Wag mag-spray ng nitrogen.",
        "Huwag deep-flood — drain hanggang 3 cm.",
      ],
      medium: [
        "Mag-spray ng Copper hydroxide (3 g/L) sa apektadong zone at 5 m buffer.",
        "I-drain ang field at panatilihing mababaw lang (3–5 cm) ang tubig.",
        "I-rogue ang lahat ng infected hills; sunugin o ilibing — wag itapon sa kanal.",
        "Linisin ang sapatos at damit pagkalabas sa palayan.",
        "Repeat na spray pagkalipas ng 7 araw kung lumalala pa.",
      ],
      high: [
        "URGENT: Copper hydroxide spray sa buong field block — hindi lang sa apektadong area.",
        "Drain field nang buo at hayaang matuyo ng 2–3 araw.",
        "I-coordinate sa katabing magsasaka — kailangan synchronized ang response.",
        "Huwag mag-replant sa parehong field sa susunod na cropping — i-rotate sa mais o gulay.",
        "Mag-report sa LGU agriculture office para sa damage assessment.",
      ],
    },
  },

  tungro: {
    name_tl: "Tungro",
    name_en: "Rice Tungro Virus Disease",
    cause: "RTBV + RTSV, kinakalat ng green leafhopper (Nephotettix virescens)",
    symptoms_tl: [
      "Kalat-kalat na yellow-orange na halaman, hindi pantay ang taas",
      "Bansot, stunted growth — apektado pati panicle exsertion",
      "Bilang ng infected hills tumataas mula sa gilid papasok",
      "Madalas may nakikitang green leafhopper sa apektadong halaman",
    ],
    conditions:
      "Maraming green leafhopper (lalo na sa puno ng wet season), staggered planting, ligaw na palay sa paligid.",
    chemicals: [
      {
        ai: "Thiamethoxam 25% WG",
        product_examples: "Actara",
        dose: "0.4 g / L tubig (100 g / hectare)",
        note: "Vector control — pinakamabisa kontra leafhopper. Hindi ginagamot ang virus.",
      },
      {
        ai: "Cartap hydrochloride 50% SP",
        product_examples: "Padan, Sumalpha",
        dose: "1.5 g / L tubig",
      },
      {
        ai: "Buprofezin 25% WP",
        product_examples: "Applaud",
        dose: "1 g / L tubig",
        note: "Para sa hopper nymphs (immature stage)",
      },
    ],
    cultural: [
      "I-rogue agad ang infected hills — sunugin, wag itapon sa kanal",
      "Synchronized planting sa buong barangay (within 2 linggo) para mabasag ang vector cycle",
      "Alisin ang ligaw na palay (volunteer rice) sa kanal at gilid",
      "Huwag mag-stagger ng planting — naghahanda lang ng buffet para sa leafhopper",
      "Mag-set ng yellow sticky traps para ma-monitor ang vector population",
    ],
    resistant_varieties: ["NSIC Rc218", "NSIC Rc224", "NSIC Rc480", "Matatag-1"],
    severity_actions: {
      low: [
        "I-rogue agad ang infected hills — bago kumalat.",
        "Mag-monitor ng leafhopper sa apektadong area gamit ang yellow sticky trap.",
        "Wag pa mag-spray — masyadong maaga.",
        "I-record ang lokasyon at i-survey ulit pagkalipas ng 5 araw.",
      ],
      medium: [
        "I-rogue lahat ng infected hills, sunugin agad.",
        "Mag-spray ng Thiamethoxam (0.4 g/L) sa apektadong area at 10 m buffer para sa leafhopper.",
        "Alisin ang ligaw na palay sa paligid ng bukid.",
        "Tawagan ang katabing magsasaka para hindi mag-stagger ng planting.",
        "Mag-monitor tuwing 3 araw sa loob ng 2 linggo.",
      ],
      high: [
        "URGENT: I-rogue ang lahat ng infected hills (kahit malaki pa) — hindi makakabawi yan.",
        "Spray ng Thiamethoxam sa buong field at katabing field para sa leafhopper control.",
        "Mag-replant kung sobra ang loss (>30%) — gamit ang resistant variety tulad ng NSIC Rc218.",
        "Coordinate sa LGU at BPI para sa community-level vector control.",
        "Synchronized planting sa buong barangay sa susunod na cropping.",
      ],
    },
  },
};

/** Compact context string for AI prompt injection. */
export function diseaseContext(d: Disease, s: Severity): string {
  const p = KB[d];
  const actions = p.severity_actions[s].map((a, i) => `${i + 1}. ${a}`).join("\n");
  const chem = p.chemicals
    .slice(0, 2)
    .map((c) => `- ${c.ai} (${c.product_examples}) sa dose na ${c.dose}${c.note ? ` [${c.note}]` : ""}`)
    .join("\n");
  return `
SAKIT: ${p.name_tl} (${p.name_en})
SANHI: ${p.cause}
KONDISYON: ${p.conditions}
SEVERITY: ${s.toUpperCase()}

REKOMENDADONG AKSYON (severity ${s}):
${actions}

CHEMICAL OPTIONS (PhilRice-aligned):
${chem}

RESISTANT VARIETIES: ${p.resistant_varieties.join(", ")}
`.trim();
}
