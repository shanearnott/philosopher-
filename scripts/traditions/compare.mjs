// Compare cards and the principles matrix for the Traditions wing (the plan's
// "Compare" card and "Core principles compared"). Summaries are written here,
// never quotes; each entry points at a verbatim card by id. Compare, don't rank:
// similarities and differences are stated as each tradition understands itself.

export const COMPARE = [
  {
    id: "giving", theme: "Giving without show",
    shared: "Every tradition here warns that goodness done to be seen loses something, and asks for giving that expects no applause.",
    differs: "They differ on why: God sees and rewards in secret, or the loss is spiritual, or detachment from all results, or simply that it is the nature of a good person.",
    entries: [
      { tradition: "Christianity", id: "christianity.15", teaching: "Give in secret, not to be seen by others; your Father who sees in secret will reward you.", similar: "Same as Marcus; adds that God, not people, sees and rewards." },
      { tradition: "Judaism", id: "judaism.15", teaching: "Open your hand to the needy; later tradition ranks anonymous giving, and above it, helping someone become self-sufficient.", similar: "Adds a practical ranking, valuing independence even above anonymity." },
      { tradition: "Islam", id: "islam.13", teaching: "Charity for show, or followed by reminders and hurt, is washed away like soil from a rock; a kind word is better.", similar: "Same warning; the loss is spiritual, not only a matter of character." },
      { tradition: "Hinduism", id: "hinduism.23", teaching: "Your concern is the work, never its fruits; act without attachment to results.", similar: "Broader: detach from all results, not just from praise." },
      { tradition: "Buddhism", id: "dhammapada.63", teaching: "Craving is never satisfied, even by showers of gold; wise action lets it go.", similar: "Frames the danger as craving itself, including the craving for recognition." },
      { tradition: "Stoicism", id: "meditations.5.6", teaching: "Do good like a vine bearing grapes, then move on without keeping an account.", similar: "Grounded in reason and nature, not in reward from God." },
    ],
  },
  {
    id: "enemies", theme: "Answering harm",
    shared: "All of these traditions ask for more than restraint: they ask for goodwill, even kindness, towards those who do us wrong.",
    differs: "The grounds differ: God's example of sending rain on all, the hope of turning an enemy into a friend, seeing one Self in all, or the refusal to let hatred into the mind.",
    entries: [
      { tradition: "Judaism", id: "judaism.16", teaching: "If your enemy is hungry, feed him; if thirsty, give him water.", similar: "Practical kindness to an enemy, with the hope of changing him." },
      { tradition: "Christianity", id: "christianity.11", teaching: "Love your enemies and pray for those who persecute you, as God is good to all.", similar: "The most demanding form: love, modelled on God's own goodness." },
      { tradition: "Islam", id: "islam.17", teaching: "Repel evil with what is better, and an enemy may become a close friend; it takes patience.", similar: "Similar aim of reconciliation, frankly admitting how hard it is." },
      { tradition: "Hinduism", id: "hinduism.11", teaching: "Dear to God is one who hates no creature and is friendly and compassionate.", similar: "Rooted in seeing the same Self in all beings." },
      { tradition: "Buddhism", id: "buddhism.8", teaching: "Even if sawn limb from limb, keep a mind free of hatred and full of love.", similar: "The strictest standard of the mind: no inner hatred at all." },
      { tradition: "Stoicism", id: "meditations.2.1", teaching: "Expect difficult people each morning; they act from ignorance, and we are made to work together.", similar: "Grounded in reason and kinship, not in divine command." },
    ],
  },
  {
    id: "justice", theme: "Justice without favour",
    shared: "Each tradition demands judgement that doesn't bend for status, wealth or kin.",
    differs: "Scriptural traditions ground justice in God's command and witness; the Gita in equal regard for all beings; the Stoics in justice as one of four virtues of reason.",
    entries: [
      { tradition: "Judaism", id: "judaism.14", teaching: "Appoint fair judges; show no favouritism and take no bribes; justice, justice shall you pursue.", similar: "Builds justice into institutions: judges, officers and rules against bribes." },
      { tradition: "Islam", id: "islam.11", teaching: "Stand firm for justice as witnesses for God, even against yourselves, parents or kin.", similar: "Extends impartiality to testimony against one's own family." },
      { tradition: "Islam", id: "islam.12", teaching: "Don't let hatred of any people make you unjust; justice is nearer to piety.", similar: "Extends justice explicitly to enemies." },
      { tradition: "Hinduism", id: "hinduism.14", teaching: "Regard friends, foes, strangers, the good and the wicked with an equal mind.", similar: "Equanimity as the root of fair judgement." },
      { tradition: "Christianity", id: "christianity.13", teaching: "Don't judge hypocritically; remove the plank from your own eye first.", similar: "Different emphasis: guards against harsh, self-righteous judgement." },
    ],
  },
  {
    id: "mortality", theme: "The shortness of life",
    shared: "Every tradition here uses the certainty of death to sharpen how we live now.",
    differs: "They differ on what comes after: judgement and the world to come, rebirth until liberation, or, for the Stoics, return to nature without a promised personal afterlife.",
    entries: [
      { tradition: "Judaism", id: "judaism.21", teaching: "Our years pass quickly; teach us to number our days to gain a heart of wisdom.", similar: "Mortality as a teacher of wisdom." },
      { tradition: "Christianity", id: "christianity.26", teaching: "Your life is a mist that appears briefly; plan humbly, if the Lord wills.", similar: "Mortality as a call to humility in planning." },
      { tradition: "Islam", id: "islam.26", teaching: "Every soul will taste death; the true reckoning comes on the Day of Resurrection.", similar: "Adds judgement and the Hereafter as the measure of success." },
      { tradition: "Hinduism", id: "hinduism.2", teaching: "The self is never born and never dies; it changes bodies like clothes.", similar: "Different: death is a passage of the eternal self, not an end." },
      { tradition: "Buddhism", id: "buddhism.13", teaching: "Reflect often: I will age, sicken, die and be parted from all I love; I own my actions.", similar: "A daily practice of remembrance to cut through vanity." },
      { tradition: "Stoicism", id: "meditations.4.17", teaching: "Don't act as if you had ten thousand years; while you live, be good.", similar: "Close to the Buddhist remembrance, without a claim about rebirth." },
    ],
  },
  {
    id: "desire", theme: "Desire and contentment",
    shared: "All of these traditions see restless wanting as a source of unhappiness, and contentment as a kind of wealth.",
    differs: "Some redirect desire towards God; Buddhism aims at the ending of craving itself; the Stoics distinguish what is in our control from what isn't.",
    entries: [
      { tradition: "Judaism", id: "judaism.26", teaching: "Who is rich? One who is content with their lot.", similar: "Contentment redefines wealth." },
      { tradition: "Christianity", id: "christianity.27", teaching: "I have learned to be content with little or with plenty, strengthened by Christ.", similar: "Uses the Stoic word for self-sufficiency, but finds it in Christ." },
      { tradition: "Islam", id: "islam.25", teaching: "Worldly life is play, show, boasting and rivalry in wealth, fading like crops after rain.", similar: "Warns specifically against display and rivalry." },
      { tradition: "Hinduism", id: "hinduism.22", teaching: "Pleasure from the senses is nectar at first and poison in the end.", similar: "Judges pleasures by their long-run effect." },
      { tradition: "Buddhism", id: "buddhism.2", teaching: "Suffering arises from craving and ends when craving fades.", similar: "Most thoroughgoing: craving itself is the root to be ended." },
      { tradition: "Stoicism", id: "enchiridion.16", teaching: "Wanting what isn't in your power makes you a slave to whoever controls it.", similar: "Grounded in the line between what is and isn't up to us." },
    ],
  },
  {
    id: "work", theme: "Work and duty",
    shared: "Each tradition treats honest, wholehearted work as part of a good life, not a distraction from it.",
    differs: "Work may be offered to God, done as one's own dharma without attachment, balanced with worship, or done as a citizen of the cosmos.",
    entries: [
      { tradition: "Judaism", id: "judaism.34", teaching: "Whatever your hand finds to do, do it with all your strength.", similar: "Wholehearted effort because life is short." },
      { tradition: "Christianity", id: "christianity.35", teaching: "Work heartily, as for the Lord and not for people.", similar: "Work as service to God, the root of the idea of vocation." },
      { tradition: "Islam", id: "islam.32", teaching: "Leave trade for Friday prayer, then go out and seek God's bounty.", similar: "Balances worship and livelihood in one rhythm." },
      { tradition: "Hinduism", id: "hinduism.25", teaching: "Better your own duty done imperfectly than another's done well.", similar: "Stresses fit between the person and the work." },
      { tradition: "Buddhism", id: "buddhism.17", teaching: "Initiative, skilful and well organised work, brings welfare in this life.", similar: "Practical: skill and organisation, with government service named." },
      { tradition: "Stoicism", id: "meditations.5.1", teaching: "When reluctant to rise, remember you rise to do the work of a human being.", similar: "Work as fulfilling our nature." },
    ],
  },
  {
    id: "humility", theme: "Pride and humility",
    shared: "All of these traditions warn that pride blinds and humility opens a person to truth.",
    differs: "Humility is framed before God, before death and the cosmos, or as freedom from the self's vanity.",
    entries: [
      { tradition: "Judaism", id: "judaism.24", teaching: "Pride goes before destruction; better to be humble with the lowly.", similar: "Pride as the prelude to a fall." },
      { tradition: "Christianity", id: "christianity.25", teaching: "The tax collector who asks for mercy goes home justified, not the self-satisfied Pharisee.", similar: "Humility before God as the condition of being right with him." },
      { tradition: "Islam", id: "islam.35", teaching: "Don't walk the earth arrogantly; you can't split the earth or match the mountains.", similar: "Deflates pride with a sense of scale." },
      { tradition: "Hinduism", id: "hinduism.9", teaching: "Among the divine qualities are modesty and freedom from vanity.", similar: "Humility as one strand of a divine character." },
      { tradition: "Buddhism", id: "buddhism.14", teaching: "Reflecting on ageing reduces the vanity of youth.", similar: "Pride dissolved by clear seeing of impermanence." },
      { tradition: "Stoicism", id: "meditations.6.30", teaching: "Take care you are not made into a Caesar; stay simple, good and modest.", similar: "Humility as a guard against the corruption of power." },
    ],
  },
  {
    id: "anger", theme: "Anger and self-mastery",
    shared: "Every tradition here counts mastering anger as a greater victory than beating an opponent.",
    differs: "The methods differ: patience and prayer, replying with peace, guarding attention, not firing the second arrow, or examining the judgement behind the anger.",
    entries: [
      { tradition: "Judaism", id: "judaism.25", teaching: "The slow to anger is better than the mighty; ruling your spirit beats taking a city.", similar: "Self-mastery ranked above conquest." },
      { tradition: "Islam", id: "islam.29", teaching: "The servants of the Merciful answer the ignorant with peace.", similar: "Refuses to be drawn into provocation." },
      { tradition: "Hinduism", id: "hinduism.16", teaching: "Dwelling on objects breeds attachment, then desire, then anger, then ruin.", similar: "Traces anger back to where attention rests." },
      { tradition: "Buddhism", id: "dhammapada.74", teaching: "Overcome anger by love and evil by good.", similar: "Answers anger with its opposite." },
      { tradition: "Christianity", id: "christianity.10", teaching: "Don't retaliate; turn the other cheek and go the extra mile.", similar: "Breaks the cycle of retaliation." },
      { tradition: "Stoicism", id: "meditations.11.18", teaching: "When offended, consider your kinship with others and that anger does more harm than the offence.", similar: "Examines the judgement that produces the anger." },
    ],
  },
  {
    id: "service", theme: "Leading by serving",
    shared: "These traditions measure leaders by service and example rather than by power.",
    differs: "Christianity makes the leader a servant; the Gita stresses that people copy the great; Judaism and Buddhism stress raising others to carry the teaching on.",
    entries: [
      { tradition: "Christianity", id: "christianity.33", teaching: "Whoever wants to be great must be the servant of all.", similar: "The origin of servant leadership." },
      { tradition: "Hinduism", id: "hinduism.13", teaching: "Whatever a great person does, others follow; act for the good of the world.", similar: "Leadership as setting the standard." },
      { tradition: "Judaism", id: "judaism.7", teaching: "Be deliberate in judgement and raise up many disciples.", similar: "Leadership as developing successors." },
      { tradition: "Buddhism", id: "buddhism.5", teaching: "Be your own island, with the teaching as your refuge.", similar: "No successor: principles, not a person, lead." },
      { tradition: "Stoicism", id: "meditations.10.16", teaching: "Stop talking about what a good man should be, and be one.", similar: "Leadership by example, without speeches." },
    ],
  },
  {
    id: "stillness", theme: "Prayer, meditation and stillness",
    shared: "Every tradition sets aside time for inward attention, away from the noise.",
    differs: "Prayer addresses God personally; meditation in the Gita and Buddhism steadies and examines the mind; the Stoic retreat is into one's own judgement.",
    entries: [
      { tradition: "Judaism", id: "judaism.29", teaching: "Happy is the one who meditates on God's law day and night.", similar: "Daily study and reflection as rootedness." },
      { tradition: "Christianity", id: "christianity.30", teaching: "Pray in secret, simply, in few words; the Lord's Prayer.", similar: "Private prayer to a personal God." },
      { tradition: "Islam", id: "islam.31", teaching: "Prayer restrains from wrongdoing, and remembrance of God is greater still.", similar: "Five daily prayers shaping conduct." },
      { tradition: "Hinduism", id: "hinduism.19", teaching: "The disciplined mind is like a lamp in a windless place.", similar: "Meditation as steadiness of attention." },
      { tradition: "Buddhism", id: "buddhism.16", teaching: "The four foundations of mindfulness: body, feelings, mind and experiences.", similar: "Systematic observation of experience." },
      { tradition: "Stoicism", id: "meditations.4.3", teaching: "You can retreat into yourself at any hour; there is no quieter place.", similar: "The retreat is into one's own judgement." },
    ],
  },
];

// The plan's matrix. It simplifies: each tradition contains wide internal variety.
export const PRINCIPLES = {
  traditions: ["Judaism", "Christianity", "Islam", "Hinduism", "Buddhism", "Sikhism", "Stoicism"],
  rows: [
    { question: "Ultimate reality", answers: ["One God", "One God as Trinity", "One God (tawhid)", "Brahman, with many deities as its forms (varies)", "No creator god at the centre", "One God (Ik Onkar)", "Rational order of nature (Logos)"] },
    { question: "The human problem", answers: ["Straying from the covenant", "Sin and separation from God", "Heedlessness and disobedience", "Ignorance binding to rebirth", "Craving, which causes suffering", "Ego (haumai)", "False judgements and passions"] },
    { question: "The path", answers: ["Commandments, repentance, study", "Faith, grace, love", "Submission to God, Five Pillars", "Knowledge, devotion or selfless action", "Noble Eightfold Path", "Remembrance, honest work, sharing", "Virtue through reason"] },
    { question: "The goal", answers: ["Righteous life; the world to come", "Eternal life with God", "Paradise and God's pleasure", "Liberation (moksha)", "Nirvana", "Union with God", "Living according to nature"] },
    { question: "After death", answers: ["Views vary", "Resurrection; heaven or hell", "Judgement; heaven or hell", "Rebirth until liberation", "Rebirth until nirvana", "Rebirth until liberation", "Return to nature; no personal afterlife asserted"] },
    { question: "Central ethic", answers: ["Justice, mercy, humility", "Love God and neighbour", "Justice, mercy, charity", "Duty (dharma), non-harm", "Compassion, non-harm", "Equality, selfless service", "Virtue, the common good"] },
  ],
  note: "A reference card. It simplifies; each tradition contains wide internal variety.",
};
