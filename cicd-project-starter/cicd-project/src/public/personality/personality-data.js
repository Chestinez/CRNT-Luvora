(function (root) {
  const version = 'luvora-v1';

  const groups = [
    {
      dimension: 'EI',
      positive: 'E',
      negative: 'I',
      statements: [
        'Spending time with a group usually leaves me feeling energised.',
        'After a busy social day, I prefer some time alone to recharge.',
        'I often start conversations with people I have just met.',
        'I prefer getting to know someone through one-to-one conversations.',
        'Talking about an idea helps me understand what I think about it.',
        'I like to think through my response before speaking.',
        'At a gathering, I enjoy meeting several different people.',
        'At a gathering, I usually spend most of my time with a few people.',
        'When something exciting happens, I want to share it with someone straight away.',
        'I often process personal experiences privately before discussing them.',
        'I enjoy being involved in lively group conversations.',
        'I feel comfortable letting others lead a conversation while I listen.',
        'I tend to suggest social activities when I have free time.',
        'A quiet evening by myself often feels satisfying.',
        'Meeting new people is something I regularly look forward to.',
        'I prefer having time to become familiar with someone before opening up.',
        'I naturally express my reactions as a conversation unfolds.',
        'I usually keep my initial reactions to myself while I reflect.',
        'I enjoy activities that involve interacting with many people.',
        'I prefer activities that allow me to focus without much social interaction.',
        'When joining a new group, I tend to introduce myself first.',
        'When joining a new group, I usually observe before participating.',
        "Having company often makes an ordinary activity more enjoyable for me.",
        "I value uninterrupted personal space, even when I enjoy someone's company.",
        'I often seek conversation when I have been alone for a while.',
      ],
    },
    {
      dimension: 'SN',
      positive: 'S',
      negative: 'N',
      statements: [
        'When learning something new, I prefer concrete examples first.',
        'I enjoy exploring what an idea could become in the future.',
        'I tend to notice the specific details of my surroundings.',
        'I often look for connections between ideas that seem unrelated.',
        'I trust information more when it is supported by direct observation.',
        'I enjoy discussing possibilities even when they have no immediate use.',
        'Clear, practical instructions help me get started.',
        'Understanding the overall concept helps me get started.',
        'When describing an experience, I usually explain what actually happened.',
        'When describing an experience, I often focus on what it might mean.',
        'I prefer trying a method that has worked before.',
        'I enjoy imagining a different approach to a familiar task.',
        'I usually focus on what can realistically be done with the resources available.',
        'I often think about possibilities beyond the resources currently available.',
        'I remember experiences through particular sights, sounds or other details.',
        'I remember experiences through their overall impression or theme.',
        'I prefer conversations that include specific examples and experiences.',
        'I enjoy conversations about abstract ideas and hypothetical situations.',
        'When considering a plan, I first want to understand its practical requirements.',
        'When considering a plan, I first imagine where it could lead.',
        'I tend to interpret instructions according to their literal wording.',
        'I often consider meanings beyond what someone has explicitly said.',
        'I find hands-on experience especially helpful when learning.',
        'I enjoy forming a theory about how something works.',
        'I prefer explanations that stay close to observable facts.',
      ],
    },
    {
      dimension: 'TF',
      positive: 'T',
      negative: 'F',
      statements: [
        'When making a difficult decision, I first check whether my reasoning is consistent.',
        'When making a difficult decision, I first consider the people affected.',
        'During a disagreement, I focus on examining the reasoning behind each position.',
        'During a disagreement, I focus on understanding what matters personally to each person.',
        'I prefer feedback that clearly identifies what needs to change.',
        "I prefer feedback that acknowledges the person's feelings and effort.",
        'When evaluating a proposal, I give strong weight to objective criteria.',
        'When evaluating a proposal, I give strong weight to the values of those involved.',
        'I usually compare the advantages and disadvantages before choosing.',
        'I usually consider whether a choice fits my personal values before choosing.',
        'I find it helpful to step back emotionally when assessing a problem.',
        'I find it helpful to imagine how each person experiences a problem.',
        'I feel comfortable questioning an argument even when I like the person making it.',
        "I pay close attention to how questioning someone's view might affect our connection.",
        'When someone asks for advice, my first instinct is to analyse possible solutions.',
        'When someone asks for advice, my first instinct is to understand how they feel.',
        'I prefer decisions to follow clearly explained principles.',
        "I prefer decisions to account for people's individual circumstances.",
        'When choosing between options, I prioritise how effectively each solves the problem.',
        'When choosing between options, I prioritise how well each reflects what matters to me.',
        'I am persuaded by an argument when its evidence and reasoning hold together.',
        'I am persuaded by an argument when it reflects values I care about.',
        'In a group decision, I naturally point out inconsistencies or trade-offs.',
        "In a group decision, I naturally draw attention to people's needs and concerns.",
        'When explaining a decision, I usually begin with the reasoning behind it.',
      ],
    },
    {
      dimension: 'JP',
      positive: 'J',
      negative: 'P',
      statements: [
        'I feel comfortable when my plans are settled in advance.',
        'I enjoy keeping my options open until closer to the time.',
        'I like to organise my tasks before beginning work.',
        'I like to begin a task and adjust my approach as I go.',
        'I prefer knowing the main arrangements before going on a date.',
        'I enjoy dates that leave room for spontaneous decisions.',
        'I usually set personal deadlines ahead of the actual deadline.',
        'I am comfortable deciding when to work based on how things develop.',
        'Finishing a decision usually gives me a sense of relief.',
        'I enjoy exploring additional options before committing to a decision.',
        'A clear daily schedule helps me feel settled.',
        'A flexible daily schedule suits me well.',
        'Before a trip, I like to organise the main activities.',
        'On a trip, I enjoy choosing activities as opportunities appear.',
        'I prefer completing one task before moving to another.',
        'I enjoy moving between tasks as my interest shifts.',
        'I like agreements to include clear next steps and timings.',
        'I like agreements that allow the details to evolve.',
        'I feel more comfortable when I know what to expect.',
        'An unexpected change of plan can make an activity more interesting to me.',
        'I tend to prepare what I need well before an event.',
        'I am comfortable making preparations close to an event.',
        'I prefer having a clear structure for a longer project.',
        'I prefer allowing a longer project to take shape as I explore it.',
        'I usually want to settle an arrangement once enough information is available.',
      ],
    },
  ];

  const dimensions = [
    {
      key: 'EI',
      name: 'Social energy',
      positive: 'E',
      negative: 'I',
      positiveLabel: 'Interaction',
      negativeLabel: 'Reflection',
    },
    {
      key: 'SN',
      name: 'Information',
      positive: 'S',
      negative: 'N',
      positiveLabel: 'Concrete details',
      negativeLabel: 'Possibilities',
    },
    {
      key: 'TF',
      name: 'Decisions',
      positive: 'T',
      negative: 'F',
      positiveLabel: 'Logical consistency',
      negativeLabel: 'Personal values',
    },
    {
      key: 'JP',
      name: 'Planning',
      positive: 'J',
      negative: 'P',
      positiveLabel: 'Structure',
      negativeLabel: 'Flexibility',
    },
  ];

  const questions = groups.flatMap((group, groupIndex) =>
    group.statements.map((text, index) => ({
      id: String(groupIndex * 25 + index + 1),
      text,
      dimension: group.dimension,
      direction: index % 2 === 0 ? 1 : -1,
    })),
  );

  // Interleave dimensions while keeping question IDs stable.
  const displayQuestions = [];

  for (let index = 0; index < 25; index += 1) {
    for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
      displayQuestions.push(questions[groupIndex * 25 + index]);
    }
  }

  const choices = [
    { value: -2, label: 'Strongly disagree' },
    { value: -1, label: 'Disagree' },
    { value: 0, label: 'Neutral' },
    { value: 1, label: 'Agree' },
    { value: 2, label: 'Strongly agree' },
  ];

  const characters = {
    ISTJ: {
      name: 'The Steady Anchor',
      symbol: '⚓',
      description: 'You tend to value practical details, consistency and clear plans.',
    },
    ISFJ: {
      name: 'The Thoughtful Keeper',
      symbol: '♡',
      description: 'You tend to show care through attention, reliability and practical support.',
    },
    INFJ: {
      name: 'The Thoughtful Dreamer',
      symbol: '✦',
      description: 'You tend to value meaningful conversations, personal values and intention.',
    },
    INTJ: {
      name: 'The Quiet Strategist',
      symbol: '⌘',
      description: 'You tend to enjoy exploring possibilities and shaping them into plans.',
    },
    ISTP: {
      name: 'The Practical Explorer',
      symbol: '◇',
      description: 'You tend to enjoy understanding how things work and adapting as you go.',
    },
    ISFP: {
      name: 'The Gentle Creator',
      symbol: '❋',
      description: 'You tend to value personal expression, present experiences and flexibility.',
    },
    INFP: {
      name: 'The Hopeful Dreamer',
      symbol: '☾',
      description: 'You tend to explore possibilities through imagination and personal values.',
    },
    INTP: {
      name: 'The Curious Thinker',
      symbol: '∞',
      description: 'You tend to enjoy exploring ideas, questioning assumptions and finding patterns.',
    },
    ESTP: {
      name: 'The Bold Explorer',
      symbol: '↗',
      description: 'You tend to enjoy active experiences, practical action and spontaneity.',
    },
    ESFP: {
      name: 'The Social Spark',
      symbol: '✳',
      description: 'You tend to enjoy shared experiences, personal connection and flexibility.',
    },
    ENFP: {
      name: 'The Possibility Seeker',
      symbol: '↟',
      description: 'You tend to bring enthusiasm to new ideas, people and possibilities.',
    },
    ENTP: {
      name: 'The Idea Explorer',
      symbol: '⌁',
      description: 'You tend to enjoy exchanging ideas, testing arguments and exploring alternatives.',
    },
    ESTJ: {
      name: 'The Clear Organiser',
      symbol: '▦',
      description: 'You tend to enjoy coordinating people and turning practical decisions into action.',
    },
    ESFJ: {
      name: 'The Warm Connector',
      symbol: '❊',
      description: 'You tend to value shared experiences, thoughtful support and clear arrangements.',
    },
    ENFJ: {
      name: 'The Encouraging Guide',
      symbol: '☼',
      description: 'You tend to enjoy understanding people and organising around shared values.',
    },
    ENTJ: {
      name: 'The Purposeful Planner',
      symbol: '➚',
      description: 'You tend to enjoy discussing possibilities and organising action toward a goal.',
    },
  };

  const data = {
    version,
    questions,
    displayQuestions,
    dimensions,
    choices,
    characters,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = data;
  } else {
    root.LuvoraPersonality = data;
  }
})(globalThis);