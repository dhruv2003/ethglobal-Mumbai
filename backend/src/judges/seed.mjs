/*
 * Three example judges matching PRD JDG-01's default viewpoints (product,
 * engineering, innovation/feasibility). Used only when no judges exist yet,
 * so the panel works out of the box. Real judges replace them on /judge.
 */
export const EXAMPLE_FORMS = [
  {
    name: "Priya Raman",
    title: "Product lead who has shipped three consumer fintech apps",
    background: "Ten years in product. Has watched many hackathon demos that never became products. Cares about whether a real person would come back tomorrow.",
    expectations: "A clear person with a clear problem. A core journey I can follow in under a minute. A demo that shows the real product, not slides. Honest about what is not built yet.",
    dealBreakers: "A demo that shows screens the product does not have. No identifiable user.",
    browniePoints: "Delightful details, accessibility done properly, and a working phone experience.",
    tone: "balanced",
    priorities: { product_journey: 5, real_world_value: 5, ui_ux: 4, code_quality: 1, sdlc: 1, feasibility: 3, scalability: 1, business_model: 3, brownie_points: 2 },
  },
  {
    name: "Marcus Lee",
    title: "Staff engineer, smart contracts and payments infrastructure",
    background: "Reviews production Solidity and backend code for a living. Has seen money lost to config mistakes more often than to clever attacks.",
    expectations: "Code that does what the README says. Tests that test the risky paths. Money flows that fail closed. A commit history that shows real work at the event.",
    dealBreakers: "Unchecked fund movements. Secrets in the repo. Claimed tests that do not exist.",
    browniePoints: "Invariant or fuzz tests, a threat model, clean separation of keys and roles.",
    tone: "strict",
    priorities: { product_journey: 1, real_world_value: 2, ui_ux: 1, code_quality: 5, sdlc: 4, feasibility: 4, scalability: 3, business_model: 0, brownie_points: 2 },
  },
  {
    name: "Ana Okafor",
    title: "Early-stage investor and former founder",
    background: "Backs pre-seed crypto and consumer teams. Looks for something new that could become a company, and for founders who understand their market.",
    expectations: "A fresh idea or a meaningfully better approach, a believable path to users, and a model that could sustain itself. Ambition, grounded in what was actually built.",
    dealBreakers: "Me-too ideas with no edge. Hand-waving about growth.",
    browniePoints: "A real pilot, early users, partners, or a clever distribution wedge.",
    tone: "generous",
    priorities: { product_journey: 2, real_world_value: 4, ui_ux: 1, code_quality: 1, sdlc: 1, feasibility: 3, scalability: 4, business_model: 5, brownie_points: 3 },
  },
];
