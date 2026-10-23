// Sections, keyword lexicons and known entities used by the rule-based classifier.
// Pure data module.

export const SECTIONS = [
  { key: 'sa_politics', scope: 'saudi', name: 'السياسة والقرارات الرسمية', hint: 'القيادة، مجلس الوزراء، الأنظمة والعلاقات الخارجية' },
  { key: 'sa_projects', scope: 'saudi', name: 'المشاريع والتنمية', hint: 'المشاريع الجديدة، التنفيذ والافتتاحات والبنية التحتية' },
  { key: 'sa_economy', scope: 'saudi', name: 'الاقتصاد السعودي', hint: 'الميزانية، التضخم، الاستثمار والتوظيف' },
  { key: 'sa_local', scope: 'saudi', name: 'الخدمات والمستجدات المحلية', hint: 'قرارات الوزارات والخدمات والتنبيهات والفعاليات' },
  { key: 'w_politics', scope: 'world', name: 'العالم والسياسة', hint: '' },
  { key: 'w_economy', scope: 'world', name: 'الاقتصاد والأسواق', hint: '' },
  { key: 'w_energy', scope: 'world', name: 'النفط والطاقة', hint: '' },
  { key: 'w_tech', scope: 'world', name: 'التقنية والذكاء الاصطناعي', hint: '' },
  { key: 'w_business', scope: 'world', name: 'الشركات والأعمال', hint: '' },
  { key: 'w_science', scope: 'world', name: 'العلوم والصحة', hint: '' },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const sectionName = (k) => SECTIONS.find((s) => s.key === k)?.name || k;

export const CONTENT_TYPES = { news: 'خبر', analysis: 'تحليل', statement: 'تصريح', update: 'تحديث جوهري' };

// Words/phrases are matched against normalized text (see arabic.normalizeArabic) as whole-word
// substrings. English entries are lower-case.
export const LEX = {
  saudi: ['السعودية', 'السعودي', 'السعوديه', 'المملكه العربيه السعوديه', 'المملكة', 'سعودي', 'الرياض', 'جدة', 'جده', 'مكة', 'مكه', 'المدينه المنوره', 'الدمام', 'نيوم', 'خادم الحرمين', 'ولي العهد', 'رؤيه 2030', 'رؤية المملكة', 'ساما', 'تاسي', 'تداول السعوديه', 'صندوق الاستثمارات العامه', 'ارامكو', 'سابك', 'واس', 'saudi', 'riyadh', 'jeddah', 'aramco', 'tadawul', 'neom', 'public investment fund', 'vision 2030'],
  sports_hard: ['كره القدم', 'مباراه', 'المباراه', 'مباريات', 'الدوري', 'دوري روشن', 'دوري ابطال', 'كاس العالم', 'كاس الملك', 'المنتخب', 'منتخب', 'لاعب', 'اللاعب', 'لاعبين', 'اللاعبين', 'مدرب', 'المدرب', 'ملعب', 'الملعب', 'انتقالات', 'انتقال اللاعب', 'صفقه انتقال', 'هدافا', 'الهداف', 'ركله جزاء', 'بطوله', 'البطوله', 'التاهل', 'تاهل', 'الفيفا', 'فيفا', 'نادي', 'النادي', 'الهلال', 'النصر', 'القادسيه', 'ريال مدريد', 'برشلونه', 'الفورمولا', 'فورمولا 1', 'التنس', 'الملاكمه', 'الاولمبيه', 'اولمبياد',
    'football', 'soccer', 'premier league', 'champions league', 'la liga', 'fifa', 'uefa', 'striker', 'midfielder', 'goalkeeper', 'transfer window', 'nba', 'nfl', 'tennis', 'formula 1', 'grand prix', 'olympic', 'cricket', 'rugby', 'golf tournament', 'football match', 'head coach'],
  transfer: ['انتقال', 'انتقالات', 'التعاقد مع', 'يتعاقد', 'تعاقد', 'عقد اللاعب', 'اعاره', 'transfer', 'signs for', 'signing', 'loan deal'],
  finance: ['استثمار', 'استثمارات', 'استحواذ', 'الاستحواذ', 'طرح عام', 'اكتتاب', 'ايرادات', 'الايرادات', 'ارباح', 'الارباح', 'صافي الربح', 'تمويل', 'ميزانيه', 'تقييم', 'حصه', 'خصخصه', 'صندوق الاستثمارات', 'اسهم', 'السوق الماليه', 'مليار', 'revenue', 'ipo', 'acquisition', 'acquire', 'valuation', 'stake', 'investment', 'privatization', 'earnings', 'profit', 'financing'],
  analysis: ['تحليل', 'قراءه في', 'رايي', 'مقال', 'وجهه نظر', 'ماذا يعني', 'لماذا', 'analysis', 'opinion', 'explainer', 'what it means', 'why '],
  statement: ['قال', 'صرح', 'تصريح', 'تصريحات', 'اكد', 'اعلن', 'said', 'says', 'told', 'statement'],
  breaking: ['عاجل', 'امر ملكي', 'اوامر ملكيه', 'يرفع الفائده', 'يخفض الفائده', 'يثبت الفائده', 'زلزال', 'اعصار', 'هجوم', 'وفاه', 'breaking', 'raises rates', 'cuts rates', 'holds rates', 'earthquake', 'declares'],
  sa_politics: ['خادم الحرمين', 'ولي العهد', 'مجلس الوزراء', 'امر ملكي', 'اوامر ملكيه', 'مرسوم', 'وزير الخارجيه', 'مجلس الشوري', 'الشوري', 'نظام', 'الانظمه', 'اتصالا هاتفيا', 'اتصال هاتفي', 'يستقبل', 'استقبل', 'مباحثات', 'قمه', 'السفير', 'الدبلوماسيه', 'العلاقات الثنائيه', 'الملك سلمان', 'الامير محمد بن سلمان', 'الحوثي', 'الحوثيون', 'الحوثيه', 'اعتداء', 'الاعتداء', 'استهداف', 'الدفاعات الجويه', 'التحالف', 'وزاره الدفاع', 'القوات المسلحه', 'تدين', 'يدين', 'ادانه', 'تضامن', 'مسيرات', 'صواريخ', 'وزير الداخليه', 'crown prince', 'king salman', 'cabinet', 'royal decree', 'foreign minister'],
  sa_projects: ['مشروع', 'مشاريع', 'المشروع', 'نيوم', 'القديه', 'البحر الاحمر', 'روشن', 'الدرعيه', 'افتتاح', 'يفتتح', 'تدشين', 'يدشن', 'البنيه التحتيه', 'انشاء', 'تشييد', 'مترو', 'قطار', 'طريق', 'الاسكان', 'وحدات سكنيه', 'نسبه الانجاز', 'التطوير', 'تطوير', 'megaproject', 'giga-project', 'construction', 'infrastructure', 'inaugurat'],
  sa_economy: ['الميزانيه', 'ميزانيه', 'التضخم', 'الناتج المحلي', 'الاستثمار الاجنبي', 'البطاله', 'التوظيف', 'سوق العمل', 'البنك المركزي السعودي', 'ساما', 'الهيئه العامه للاحصاء', 'الاحصاء', 'الصادرات', 'الواردات', 'الايرادات غير النفطيه', 'الانفاق', 'الدين العام', 'الصكوك', 'القروض', 'الائتمان', 'نمو الاقتصاد', 'الاقتصاد السعودي', 'تاسي', 'مؤشر السوق', 'الاسهم السعوديه', 'السوق الماليه السعوديه', 'هيئه السوق الماليه', 'تداول السعوديه', 'اكتتاب', 'طرح عام', 'النتائج الماليه', 'صافي الربح', 'توزيعات', 'tasi', 'tadawul', 'الاقتصاد', 'الاستثمار', 'وزاره الاستثمار', 'القطاع الخاص', 'غير النفطيه', 'الموانئ', 'الشحن', 'التجاره', 'الصناعه', 'التعدين', 'المحتوي المحلي', 'السياحه', 'inflation', 'gdp', 'budget', 'unemployment', 'sama'],
  sa_local: ['وزاره', 'الوزاره', 'خدمه', 'منصه', 'تنبيه', 'الارصاد', 'الدفاع المدني', 'فعاليه', 'موسم', 'المرور', 'الجوازات', 'امانه', 'بلديه', 'التعليم', 'الصحه', 'المستشفي', 'الهلال الاحمر', 'التاشيره', 'الحج', 'العمره'],
  w_energy: ['النفط', 'نفط', 'برنت', 'خام', 'اوبك', 'اوبك+', 'الغاز', 'الغاز الطبيعي', 'الطاقه', 'الكهرباء', 'الطاقه المتجدده', 'الطاقه الشمسيه', 'برميل', 'oil', 'crude', 'brent', 'opec', 'lng', 'natural gas', 'energy', 'barrel', 'renewable', 'solar', 'electricity'],
  w_tech: ['الذكاء الاصطناعي', 'ذكاء اصطناعي', 'تقنيه', 'التقنيه', 'تكنولوجيا', 'رقائق', 'اشباه الموصلات', 'الامن السيبراني', 'تطبيق', 'روبوت', 'الهواتف الذكيه', 'ai', 'artificial intelligence', 'openai', 'chip', 'chips', 'semiconductor', 'software', 'cyber', 'robot', 'language model', 'nvidia', 'google', 'microsoft', 'apple', 'meta', 'anthropic'],
  w_science: ['الصحه', 'دراسه', 'باحثون', 'الباحثين', 'العلماء', 'علماء', 'مرض', 'لقاح', 'فيروس', 'السرطان', 'منظمه الصحه العالميه', 'الفضاء', 'ناسا', 'وباء', 'علاج', 'health', 'study', 'researchers', 'scientists', 'disease', 'vaccine', 'virus', 'cancer', 'nasa', 'space', 'clinical trial', 'outbreak', 'species', 'climate'],
  w_economy: ['الاحتياطي الفيدرالي', 'الفيدرالي', 'الفائده', 'اسعار الفائده', 'التضخم', 'الاسواق', 'البورصه', 'الاسهم', 'الذهب', 'الدولار', 'اليورو', 'البنك المركزي', 'المركزي الاوروبي', 'السندات', 'الركود', 'الناتج المحلي', 'صندوق النقد', 'البنك الدولي', 'الرسوم الجمركيه', 'fed', 'federal reserve', 'ecb', 'interest rate', 'rates', 'inflation', 'stocks', 'bonds', 'treasury', 'gdp', 'recession', 'imf', 'tariff', 'central bank', 'bank of england'],
  w_business: ['شركه', 'الشركه', 'استحواذ', 'صفقه', 'الرئيس التنفيذي', 'اندماج', 'ارباح', 'ايرادات', 'تسريح', 'merger', 'acquisition', 'ceo', 'earnings', 'revenue', 'layoffs', 'startup', 'deal', 'sec'],
  w_politics: ['الرئيس', 'الحكومه', 'الانتخابات', 'البرلمان', 'وزير', 'الحرب', 'هدنه', 'مجلس الامن', 'الامم المتحده', 'عقوبات', 'قمه', 'president', 'government', 'election', 'parliament', 'minister', 'war', 'ceasefire', 'sanctions', 'united nations'],
};

// Tadawul-listed companies with verified ticker symbols. Financial figures are never seeded;
// they must be entered from original disclosures (admin) with a source link.
export const COMPANIES = [
  { symbol: '2222', name: 'أرامكو السعودية', aliases: ['ارامكو', 'أرامكو', 'aramco', 'saudi aramco'], sector: 'الطاقة' },
  { symbol: '1120', name: 'مصرف الراجحي', aliases: ['الراجحي', 'al rajhi', 'alrajhi'], sector: 'البنوك' },
  { symbol: '1180', name: 'البنك الأهلي السعودي', aliases: ['البنك الاهلي السعودي', 'الأهلي السعودي', 'saudi national bank'], sector: 'البنوك' },
  { symbol: '1010', name: 'بنك الرياض', aliases: ['بنك الرياض', 'riyad bank'], sector: 'البنوك' },
  { symbol: '1150', name: 'مصرف الإنماء', aliases: ['مصرف الانماء', 'بنك الانماء', 'alinma'], sector: 'البنوك' },
  { symbol: '2010', name: 'سابك', aliases: ['سابك', 'sabic'], sector: 'المواد الأساسية' },
  { symbol: '2020', name: 'سابك للمغذيات الزراعية', aliases: ['سابك للمغذيات', 'sabic agri-nutrients'], sector: 'المواد الأساسية' },
  { symbol: '1211', name: 'معادن', genericName: true, aliases: ['شركة معادن', 'معادن السعودية', 'شركة التعدين العربية السعودية', 'maaden', "ma'aden"], sector: 'المواد الأساسية' },
  { symbol: '7010', name: 'إس تي سي', aliases: ['اس تي سي', 'stc', 'الاتصالات السعودية'], sector: 'الاتصالات' },
  { symbol: '2082', name: 'أكوا باور', aliases: ['اكوا باور', 'acwa power'], sector: 'المرافق العامة' },
  { symbol: '5110', name: 'السعودية للكهرباء', aliases: ['الشركة السعودية للكهرباء', 'saudi electricity'], sector: 'المرافق العامة' },
  { symbol: '2280', name: 'المراعي', genericName: true, aliases: ['شركة المراعي', 'almarai'], sector: 'إنتاج الأغذية' },
  { symbol: '4013', name: 'د. سليمان الحبيب', aliases: ['سليمان الحبيب', 'الحبيب الطبية', 'sulaiman al habib'], sector: 'الرعاية الصحية' },
  { symbol: '7203', name: 'علم', genericName: true, aliases: ['شركة علم', 'elm company'], sector: 'التطبيقات وخدمات التقنية' },
  { symbol: '4190', name: 'جرير', genericName: true, aliases: ['مكتبة جرير', 'جرير للتسويق', 'jarir marketing'], sector: 'تجزئة السلع الكمالية' },
];

// Countries as "actors" in a headline: "مصر تدين..." and "قطر تدين..." are different statements.
// Forms are normalized (see arabic.normalizeArabic); multi-word forms are matched as substrings.
export const COUNTRIES = [
  ['sa', ['السعوديه', 'سعودي', 'سعوديه', 'السعودي', 'المملكه', 'الرياض', 'saudi', 'riyadh']],
  ['ae', ['الامارات', 'اماراتي', 'اماراتيه', 'الاماراتي', 'الاماراتيه', 'ابوظبي', 'دبي', 'uae', 'emirates']],
  ['qa', ['قطر', 'قطري', 'قطريه', 'القطري', 'القطريه', 'الدوحه', 'qatar']],
  ['kw', ['الكويت', 'كويتي', 'الكويتي', 'الكويتيه', 'kuwait']],
  ['bh', ['البحرين', 'بحريني', 'البحريني', 'البحرينيه', 'bahrain']],
  ['om', ['سلطنه عمان', 'العماني', 'العمانيه', 'oman']],
  ['jo', ['الاردن', 'اردني', 'الاردني', 'الاردنيه', 'jordan']],
  ['eg', ['مصر', 'مصري', 'المصري', 'المصريه', 'القاهره', 'egypt']],
  ['iq', ['العراق', 'عراقي', 'العراقي', 'العراقيه', 'بغداد', 'iraq']],
  ['sy', ['سوريا', 'السوري', 'السوريه', 'دمشق', 'syria']],
  ['lb', ['لبنان', 'اللبناني', 'اللبنانيه', 'بيروت', 'lebanon']],
  ['ye', ['اليمن', 'اليمني', 'اليمنيه', 'yemen']],
  ['sd', ['السودان', 'السوداني', 'السودانيه', 'sudan']],
  ['ir', ['ايران', 'الايراني', 'الايرانيه', 'طهران', 'iran']],
  ['tr', ['تركيا', 'التركي', 'التركيه', 'انقره', 'turkey', 'turkiye']],
  ['il', ['اسرائيل', 'الاسرائيلي', 'الاسرائيليه', 'israel']],
  ['us', ['امريكا', 'اميركا', 'الامريكي', 'الاميركي', 'الامريكيه', 'الاميركيه', 'واشنطن', 'الولايات المتحده', 'usa', 'america']],
  ['ru', ['روسيا', 'الروسي', 'الروسيه', 'موسكو', 'russia', 'kremlin']],
  ['cn', ['الصين', 'الصيني', 'الصينيه', 'بكين', 'china', 'beijing']],
  ['fr', ['فرنسا', 'الفرنسي', 'الفرنسيه', 'باريس', 'france']],
  ['de', ['المانيا', 'الالماني', 'الالمانيه', 'برلين', 'germany']],
  ['gb', ['بريطانيا', 'البريطاني', 'البريطانيه', 'لندن', 'britain', 'uk']],
  ['ua', ['اوكرانيا', 'الاوكراني', 'الاوكرانيه', 'كييف', 'ukraine']],
  ['in', ['الهند', 'الهندي', 'الهنديه', 'india']],
  ['pk', ['باكستان', 'الباكستاني', 'pakistan']],
  ['jp', ['اليابان', 'الياباني', 'japan']],
  ['cy', ['قبرص', 'القبرصي', 'cyprus']],
];

export const ORGS = [
  ['صندوق الاستثمارات العامة', ['صندوق الاستثمارات', 'pif', 'public investment fund']],
  ['البنك المركزي السعودي', ['ساما', 'sama']],
  ['هيئة السوق المالية', ['هيئه السوق الماليه', 'capital market authority']],
  ['تداول السعودية', ['تداول', 'tadawul', 'saudi exchange']],
  ['أوبك', ['اوبك', 'opec']],
  ['الاحتياطي الفيدرالي', ['الفيدرالي', 'federal reserve', 'the fed']],
  ['البنك المركزي الأوروبي', ['المركزي الاوروبي', 'ecb', 'european central bank']],
  ['صندوق النقد الدولي', ['صندوق النقد', 'imf']],
  ['منظمة الصحة العالمية', ['منظمه الصحه العالميه', 'world health organization']],
  ['الأمم المتحدة', ['الامم المتحده', 'united nations']],
  ['مجلس الوزراء', ['مجلس الوزراء', 'cabinet']],
  ['نيوم', ['نيوم', 'neom']],
  ['البحر الأحمر الدولية', ['البحر الاحمر الدوليه', 'red sea global']],
  ['القدية', ['القديه', 'qiddiya']],
  ['روشن', ['روشن', 'roshn']],
  ['الدرعية', ['الدرعيه', 'diriyah']],
  ['أوبن إيه آي', ['openai', 'اوبن اي ايه']],
  ['إنفيديا', ['nvidia', 'انفيديا']],
];
