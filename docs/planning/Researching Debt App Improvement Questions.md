# **Architectural Optimization of Debt Restructuring Platforms: A Behavioral Economics and FinTech Framework**

The landscape of consumer debt management is characterized by a fundamental tension between mathematical optimality and human psychology. While classical finance models assume rational actors who continuously optimize their balance sheets to minimize interest expenses, empirical observations reveal persistent, systematic deviations from rationality. Consumers frequently make repayment decisions based on cognitive heuristics, succumb to emotional biases, and struggle with structural household barriers that digital financial tools must address to be effective.  
Understanding these behaviors is critical given the massive scale of consumer liabilities. By the third quarter of 2023, the average American held $104,215 in debt. Simultaneously, high-interest unsecured debt has become increasingly burdensome, with average credit card Annual Percentage Rates (APRs) in the United States climbing to 21.47% in 2024\. Over-indebtedness—defined as the inability to service debt using current earnings and assets —exerts massive financial and psychological tolls.  
This report provides a behavioral economics framework for optimizing a debt and Equated Monthly Installment (EMI) restructuring application. By synthesizing empirical literature on debt repayment strategies, cognitive biases, household financial frictions, and fintech business models, this analysis establishes a high-impact research agenda. This agenda is structured around four primary research questions designed to be surprising to domain experts, highly fruitful for product development, rigorous in foreclosing alternative explanations, and feasible to execute.

## **Repayment Concentration and Proportional Balance Dynamics**

In personal finance, the debate between the mathematically optimal "debt avalanche" method (prioritizing high-interest liabilities) and the psychologically rewarding "debt snowball" method (prioritizing low-balance liabilities) is well-documented. The debt avalanche method minimizes overall interest payments, whereas the snowball method offers rapid psychological feedback through "quick wins".  
Empirical studies demonstrate that the avalanche method consistently saves more money on interest than the snowball method, particularly when interest rates vary widely. For example, applying an extra $100 monthly payment to a high-interest loan under the avalanche framework can reduce a repayment timeline by two years and save $5,750 in interest charges. Across a larger portfolio, this can result in total interest payments of $45,340, saving nearly $12,000 compared to paying only minimums.  
In contrast, applying that same $100 monthly surplus under a snowball framework results in $51,000 in total interest paid, yielding only $6,240 in savings. Despite this mathematical disadvantage, several researchers have found that the snowball method is more likely to lead to complete debt elimination. This paradox occurs because the immediate gratification of clearing small balances reinforces financial discipline and sustains long-term motivation.

| Repayment Strategy | Primary Sorting Metric | Optimization Target | Behavioral Mechanism | Average Estimated Interest Savings | Target User Profile |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Debt Avalanche** | Interest Rate (APR) | Total Interest Cost | Rational Utility Maximization | Highly optimal ($12,000+ savings across portfolio) | Cost-sensitive, highly disciplined, high cognitive reflection |
| **Debt Snowball** | Outstanding Balance | Number of Open Accounts | Emotional Gratification via Account Closure | Sub-optimal ($6,240 savings across portfolio) | High stress, motivated by rapid structural changes |
| **Proportional Sequential** | Proportional Reduction Potential (R\_{i,t}) | Single-Account Progress Perception | Cognitive Progress Salience and Heuristics | Variable; approaches avalanche when customized | Low trait self-control, high risk of debt fatigue |
| **Dispersed Repayment** | Equal or Ad-Hoc Allocation | None (Sub-optimal) | Mental Accounting Fragmentation | Worst-performing ($0 extra savings) | Unstructured, low financial literacy |

A deeper examination of the psychological drivers of debt repayment reveals that the binary distinction between snowball and avalanche strategies overlooks a more fundamental mechanism: repayment concentration. Research demonstrates that sequential repayment strategies—where monthly payments are concentrated into a single account rather than dispersed across multiple accounts—significantly boost consumer motivation and accelerate the debt-free timeline.  
This motivational surge is driven by *proportional balance reduction* rather than the absolute dollar amount of the payment or the total remaining debt. Consumers infer overall progress toward their debt-clearance goal from the largest percentage reduction achieved within any single account.  
Let B\_{i,t-1} be the beginning balance of debt account i at time t, and let P\_{i,t} be the payment directed to that account. The proportional balance reduction R\_{i,t} is mathematically represented as:  
Perceived progress \\Psi\_t is a function of the maximum proportional reduction achieved across any single account in the portfolio:  
Concentrating payments into the smallest account maximizes \\max\_{i} R\_{i,t}, creating a powerful cognitive signal of goal velocity. This effect is particularly pronounced in individuals with low trait self-control, who generally struggle with long-term financial discipline. Importantly, research published in the *Journal of Consumer Research* shows that consumers who concentrate their repayment on one of their several accounts pay down their debt 15% faster than those who spread payments equally across multiple accounts.

### **Research Question 1: Proportional Progress Salience vs. Interest Optimization in Dynamic Restructuring**

**How does the visual and operational salience of proportional balance reduction (R\_{i,t}) interact with varying interest rate differentials (\\Delta r) to affect long-term repayment persistence in users with low versus high trait self-control?**

#### **Surprising to Experts**

Traditional fintech platforms and consumer lenders operate under the assumption that consolidating multiple debts into a single, lower-interest loan is always the superior product intervention because it minimizes interest costs and simplifies payment structures. However, this consolidation destroys the psychological benefit of proportional balance reduction by merging separate accounts into one large, monolithic balance.  
This research question proposes that for low-self-control users, maintaining highly salient "virtual sub-accounts" within a consolidated loan interface—and allowing users to sequentially "extinguish" these virtual sub-units—will yield higher repayment persistence and lower default rates than a standard, consolidated loan interface, even if the consolidated instrument has a slightly higher interest rate.

#### **Downstream Fruitfulness**

Answering this question will allow designers to build "psychologically segmented" consolidation loans. Instead of a single $10,000 balance at 12% APR, the app can present a "dynamically partitioned" loan that visualizes progress as the sequential elimination of five virtual $2,000 goals. This opens up new pathways for structured refinancing products that preserve the motivational mechanics of the debt snowball.

#### **Rigorous Foreclosure of Alternatives**

To isolate proportional progress salience as the causal driver, the study must control for the overall interest rate, total debt, income volatility, and monthly payment capacity. By utilizing randomized A/B testing inside the app, researchers can present identical financial structures while varying only the user interface visualization:

* **Group A**: Standard consolidated balance visualization.  
* **Group B**: Dynamically partitioned virtual sub-accounts with sequential progress tracking.

#### **Execution Feasibility**

This research is highly feasible. It requires no changes to the underlying lending agreements or legal repayment structures. It can be executed entirely through front-end user interface modifications and tracked using standard in-app engagement metrics, monthly payment completion rates, and retention rates.

## **Deconstructing the Co-Holding Puzzle**

A persistent anomaly on household balance sheets is the "credit card debt puzzle" or the "co-holding puzzle," where consumers simultaneously hold high-cost unsecured debt and low-yield liquid assets. From a purely rational perspective, this represents a severe violation of simple arbitrage, as the interest paid on revolving debt vastly exceeds the interest earned on bank deposits.  
Let L\_t be the liquid assets held in bank deposits at interest rate r\_{L,t}, and let D\_t be the revolving high-interest debt outstanding at rate r\_{D,t}. The periodic financial loss \\Pi\_t incurred by the consumer due to co-holding is:  
In 2019, approximately 42% of consumers fell into the "borrower-saver" category, carrying $100 or more in revolving credit card debt and $100 or more in liquid assets. The average borrower-saver carried almost $6,400 in unpaid credit card debt and maintained $5,400 in liquid bank deposits.  
Historically, economists attributed this behavior to liquidity constraints, arguing that consumers maintain checking account balances to pay bills that cannot be charged to credit cards, such as rent or mortgages. Indeed, borrower-savers paid approximately 80% of their bills by value using out-of-bank payment instruments (e.g., electronic checks or ACH transfers), leaving checking balances highly depleted relative to outstanding debt.  
However, empirical analyses using monthly panel data suggest that liquidity needs only partially explain the phenomenon. Co-holding persists even among highly liquid households with minimal credit limit risk, and many consumers decline low-cost liquidity offers that could extinguish their expensive debt. Instead, two primary non-liquidity mechanisms drive this puzzle:

1. **Limited Intra-Household Financial Pooling**: Couples co-hold approximately 42% more debt and assets as a unit than they do as individuals. Frictions within households prevent the efficient pooling of assets to pay down individual debts, leading to parallel borrowing and saving within the same home.  
2. **Minimum Payment Anchoring**: A significant portion of individual co-holding is driven by consumers who anchor their monthly payments to or near the minimum required payment listed on their credit card statement, rather than paying what their liquid assets would allow. This anchoring is exacerbated by mental accounting, where savings are compartmentalized and treated as untouchable.

| Explanatory Theory | Underlying Mechanism | Target Interface Variable | FinTech Solution Strategy |
| :---- | :---- | :---- | :---- |
| **Liquidity-Based Theory** | Precautionary cash hoarding for non-card bills. | Bill cycle alignment, cash buffer targets. | Dynamic cash flow modeling and automated short-term borrowing limits. |
| **Intra-Household Friction** | Non-cooperative asset pooling within couples. | Individual vs. joint account visibility. | Multi-user shared debt dashboards with opt-in asset-matching algorithms. |
| **Payment Anchoring** | Cognitive bias toward statement minimums. | Slider scales, default payment prompts. | Restructured payment interfaces that anchor on "time-to-clear" rather than minimums. |

### **Research Question 2: Overcoming Intra-Household Frictions and Payment Anchoring via Shared Anchoring Algorithms**

**Can a multi-user debt-restructuring interface that combines joint-balance aggregation with dynamic payment slider adjustments reduce household-level co-holding (\\Pi\_t) more effectively than individual-level restructuring tools, and does this reduction vary based on the gender of the primary financial decision-maker?**

#### **Surprising to Experts**

Product designers often treat personal finance apps as single-user experiences or focus on simple joint budgets. This research question suggests that individual-centric personal finance tools fail to resolve the co-holding puzzle because they ignore the non-cooperative bargaining dynamics within couples.  
By building joint dashboards that explicitly highlight the household loss (\\Pi\_t) caused by uncoordinated saving and borrowing, a fintech application can motivate cooperative debt clearance that individual budgeting tools cannot trigger.

#### **Downstream Fruitfulness**

This study will provide design patterns for multi-user financial interfaces. It will establish whether joint-account optimization algorithms can unlock dormant household liquidity, which is highly valuable for credit-scoring models and debt-consolidation underwriting.

#### **Rigorous Foreclosure of Alternatives**

To prove that the reduction in co-holding is driven by the joint-bargaining design rather than simply an increase in overall household income or financial literacy, the research design must:

* Compare couples using a joint dashboard against a control group of couples using individual accounts.  
* Control for baseline household income, individual risk tolerances, and baseline credit scores.  
* Monitor whether the joint interface shifts spending to other credit lines, which would indicate a substitution effect rather than true debt reduction.

#### **Execution Feasibility**

The study is highly feasible for any app that supports multi-account linking. It can be implemented by allowing partners to link their individual accounts to a shared dashboard, and measuring the resulting changes in monthly repayment allocations and cash-to-debt ratios over a six-month period.

## **Cognitive Interventions: Mitigating the Ostrich Effect and Pain of Paying**

The "ostrich effect"—the psychological tendency to avoid negative financial information when one is in distress—presents a major hurdle for debt-repayment platforms. Coined by economists Dan Galai and Orly Sade, this bias explains why stock market investors check their portfolios less frequently during market downturns, and why indebted consumers often avoid opening credit card bills, checking their account balances, or engaging with debt-repayment tools.  
The ostrich effect is driven by loss aversion, present bias, and a desire to protect one's ego from uncomfortable realities. It creates a negative feedback loop: as debts grow, anxiety increases, causing the consumer to ignore their accounts, which leads to late fees, high interest, and further balance increases.  
To counter this avoidance behavior, developers must address the "pain of paying". This concept, popularized by behavioral economists Drazen Prelec and George Loewenstein, explains how parting with money feels like an immediate loss, reducing the pleasure of consumption.  
Credit cards mitigate this pain by decoupling consumption from payment, encouraging higher spending and debt accumulation. Conversely, making manual payments to clear high-interest debt offers little immediate emotional reward and is felt as a direct loss.  
To overcome this, platforms can leverage *prospective accounting*. Under this model, consumption that is prepaid is enjoyed as if it were free, and prepayments are buffered by thoughts of future benefits. Applying prospective accounting to debt management suggests that flat-rate, automated payment systems can reduce the pain of paying by shifting payments from manual transactions to a steady, predictable subscription-like experience.

### **Research Question 3: Prospective Accounting vs. Manual Interventions in Reducing Information Avoidance**

**Does a "prospective flat-rate subscription" debt-payment model—wherein a fixed monthly pool is automatically distributed across debts—reduce user-initiated information avoidance (the ostrich effect) and increase program retention compared to manual, high-engagement budgeting models (e.g., zero-based budgeting)?**

#### **Surprising to Experts**

Many popular personal finance apps, such as YNAB, advocate for active, hands-on budget management where users must manually assign a job to every dollar. This approach assumes that high-touch engagement builds financial discipline.  
This research question challenges that assumption, proposing that for highly indebted, stressed consumers, high-touch manual budgeting triggers the ostrich effect and leads to app abandonment. By contrast, an automated, low-touch "prospective subscription" interface will reduce the pain of paying, lower psychological distress, and keep users on track longer.

#### **Downstream Fruitfulness**

This research can guide the development of next-generation autopay systems. If automated, flat-rate allocation models reduce default rates, fintech platforms can negotiate lower capital costs with lenders, passing the savings on to users.

#### **Rigorous Foreclosure of Alternatives**

To isolate the psychological effect of prospective accounting, the research must control for:

* **The structural repayment strategy**: Keep the underlying strategy (e.g., snowball or avalanche) identical across test groups.  
* **The user's initial debt-to-income ratio**: To ensure results are not skewed by different financial capacities.  
* **External cash shocks**: Monitor checking account activity to ensure a sudden loss of income does not distort the abandonment metrics.

#### **Execution Feasibility**

This study is highly feasible. It can be evaluated by setting up two onboarding flows in an app: one requiring manual monthly approval for debt transfers, and another that automates these transfers via a fixed monthly subscription pool. Researchers can then track app open rates, notification engagement, and payout success rates over time.

## **Demographic and Psychographic Segmentation in Credit Usage**

Designing effective financial intervention strategies requires a detailed understanding of the demographic and psychographic variations among borrowers. Unsecured debt typically peaks early in the life cycle, with households aged 25–29 exhibiting the highest levels of credit card and personal loan liabilities.  
Qualitative studies of debt repayment behavior, such as Watson and Barnao's student debt research, identify distinct behavioral profiles :

* **Expedient Payees and Traditionalists**: Driven by a strong aversion to financial risk, these individuals are willing to live frugally to pay off their loans as quickly as possible. They avoid credit cards and reject carrying balances over time.  
* **Passive Resigners**: These borrowers view debt as a permanent condition, demonstrating low engagement and a high susceptibility to information avoidance.

Among higher-income and affluent consumers, credit usage is highly divided. Approximately 80% of borrowing among the wealthy aligns with "rational leverage" (e.g., tax optimization, borrowing to invest), while the remaining 20% is driven by cognitive biases like overconfidence and optimism bias.  
Across all income levels, the Theory of Planned Behavior shows that risk tolerance and financial self-confidence are the strongest predictors of credit accumulation. Interestingly, gender moderates these dynamics: men with high financial confidence tend to accumulate significantly more credit card debt, whereas self-control serves as an effective moderating shield for women, neutralizing credit-expansion tendencies even when high income is present.  
                `Intra-Household Financial Dynamics`  
                  
         `[ Gender Influence ]  [span_100](start_span)[span_100](end_span)     [ Portfolio Impact ]`  
   `Risk Tolerance -------> Men: Debt Accrual  ---> Co-Holding Puzzle`  
   `Self-Confidence ------> Women: Self-Control ----> Mitigation of Debt`

Integrating these behavioral and psychological traits allows fintech platforms to build "subjective credit scoring models". These models quantify non-financial data—such as self-control, time preference, and cognitive reflection—to assess a borrower's willingness and capacity to repay. This is particularly valuable for underbanked or younger populations who lack a traditional credit history but demonstrate highly responsible behavioral markers.  
To maintain analytical rigor, it is vital to distinguish between direct consumer debt apps and business management software. While tools like "Biz Analyst" integrate Tally ERP9 to allow merchants to track sales, generate invoices, and send GST-compliant payment reminders on mobile devices , consumer fintech apps like Tally focus strictly on credit card consolidation and automated payments. This distinction ensures that consumer behavioral theories are applied only to retail banking tools, not business-to-business accounting packages.

## **FinTech Business Models: The Feature-vs.-Business Dilemma**

The demise of Tally Technologies highlights a major business-model challenge for consumer debt-repayment platforms. Tally offered an automated credit card management tool that extended low-interest lines of credit to consolidate high-interest credit card debt, taking over monthly payments for users. While the tool solved a real consumer problem, Tally struggled as a standalone direct-to-consumer (D2C) business for two reasons :

1. **Selection Bias and Intention Realization**: Getting out of debt requires a deliberate, active decision by the consumer. The majority of consumers avoid confronting their debt, limiting the addressable market for D2C debt-relief apps to a small, self-selected group of highly motivated users.  
2. **Monetization Incoherence**: It is highly lucrative to help consumers take on debt (through lead generation fees from lenders), but difficult to monetize helping them pay it off. Standalone debt-payoff tools must either charge subscription fees—which cash-strapped debtors struggle to pay—or provide credit consolidation lines, which exposes the platform to high balance sheet risk and rising customer acquisition costs (CAC).

This friction has driven a shift away from D2C apps toward embedded finance. Rather than existing as standalone apps, debt-management tools are increasingly being integrated into broader lending platforms, such as LendingClub and Pagaya.  
In these ecosystems, debt-restructuring tools serve as customer acquisition engines and retention features. They keep users engaged after they take out a loan, lower default rates, and identify prime candidates for refinancing.

| Platform | Product Delivery Model | Primary Revenue Engine | Core Features & Automation | Target Market Segment |
| :---- | :---- | :---- | :---- | :---- |
| **Tally** (Direct-to-Consumer) | Standalone App | Credit Line Interest Margin | Fully automated payments, consolidation loans | Mid-to-high credit scores (580-660+ FICO) |
| **DebtIQ** (Embedded) | LendingClub Platform Feature | Loan Origination & Cross-Sales | Debt scoring, simulated payoffs, refinance on-ramp | Credit-conscious borrowers, refinancing candidates |
| **Undebt.it** | Standalone Web/App | Low-cost subscription ($12/year) | Manual tracking, highly customizable payoff options | Low-budget, highly motivated self-trackers |
| **Qoins** | Standalone App | Monthly subscription ($4.99/month) | Automated savings sweeps applied to debt | Younger consumers (Gen Z / Millennials) |
| **YNAB** | Standalone App | High-cost annual subscription | Holistic zero-based budgeting, manual entry | Disciplined savers, high financial literacy |

### **Research Question 4: Behavioral Underwriting & Engagement Optimization in Embedded Restructuring Environments**

**How does integrating psychometric underwriting data (such as trait self-control and cognitive reflection scores) into an adaptive, gamified debt-restructuring tool affect customer acquisition cost (CAC), loan repayment performance, and customer lifetime value (LTV) when deployed as an embedded B2B2C feature compared to a standalone D2C application?**

#### **Surprising to Experts**

Financial institutions usually view behavioral finance features (like gamification, milestone rewards, and interactive calculators) as superficial engagement tools rather than underwriting assets. This research question proposes that user interactions with gamified debt features generate highly predictive psychometric data.  
By analyzing how users interact with these features, platforms can assess creditworthiness and predict defaults more accurately than traditional credit models, particularly for thin-file borrowers.

#### **Downstream Fruitfulness**

This research can unlock new partnership structures between fintech firms and major banks. If behavioral data from debt-repayment tools can lower credit default risk, banks will integrate these tools into their core digital portfolios, providing a sustainable, B2B-funded monetization path for behavioral personal finance tools.

#### **Rigorous Foreclosure of Alternatives**

To demonstrate that psychometric data improves credit risk prediction, the model must be tested against standard underwriting variables (such as FICO scores, debt-to-income ratios, and employment history). The predictive accuracy of the behavioral model must be isolated, proving it provides incremental lift beyond traditional data.

#### **Execution Feasibility**

This research is highly feasible through white-label partnerships or academic-fintech collaborations. By embedding a simple psychometric questionnaire or gamified financial module into an existing lender's onboarding flow, developers can collect behavioral data and track its correlation with loan repayment performance over a 12-to-18-month cycle.

## **Platform Recommendations**

To build a high-performance debt and EMI restructuring platform, product design must bridge the gap between behavioral economics and operational feasibility.  
                      `Unified App Architecture Schema`  
                        
                   `+----------------------------------+`  
                   `|      Consumer Interface Layer    |`  
                   `|  - Dynamic Progress Salience     |`  
                   `|  - "Joint Wallet" View (Couples) |`  
                   `+----------------+-----------------+`  
                                    `|`  
                                    `v`  
                   `+----------------+-----------------+`  
                   `|     Behavioral Processing Core   |`  
                   `|  - Soft-Behavioral Risk Analysis |`  
                   `|  - Minimum-Payment De-anchoring  |`  
                   `+----------------+-----------------+`  
                                    `|`  
                                    `v`  
                   `+----------------+-----------------+`  
                   `|    Platform Capital & API Layer  |`  
                   `|  - Automated Clearinghouse (ACH) |`  
                   `|  - Embedded Financial Partners   |`  
                   `+----------------------------------+`

### **1\. Shift from Absolute to Proportional Progress Salience**

The app's dashboard should prioritize proportional balance reduction (R\_{i,t}) over absolute dollar metrics.

* **Implementation**: Visualize debt payoff using progress bars that highlight the percentage of each account cleared. Group balances into dynamic, virtual sub-goals (e.g., "Pay off 25% of Card A") to give users frequent, motivating wins.  
* **Impact**: Keeps users with lower self-control motivated and engaged, lowering early-stage churn.

### **2\. Introduce Joint Dashboard Capabilities to Resolve Couple Co-Holding**

Provide tools specifically designed to identify and resolve co-holding inefficiencies within households.

* **Implementation**: Allow partners to link their accounts and view a unified household dashboard. The interface should calculate and display the interest drag (\\Pi\_t) caused by parallel saving and borrowing, offering an easy, one-click option to pay down high-interest debt using joint assets.  
* **Impact**: Addresses the 42% co-holding premium observed in couples, unlocking household liquidity and accelerating debt payoff.

### **3\. Deploy "Pain-Buffered" Subscriptions to Counter the Ostrich Effect**

Mitigate the ostrich effect and the pain of paying by moving away from manual payment flows.

* **Implementation**: Offer a subscription-like automated repayment program that aggregates debt payments into a single, predictable monthly transfer. Use prospective accounting concepts to frame these transfers as long-term investments in financial freedom.  
* **Impact**: Reduces financial anxiety, limits information avoidance, and improves long-term payment completion rates.

### **4\. Transition to an Embedded B2B2C Monetization Model**

Avoid the high CAC and low monetization potential of standalone D2C apps by pivoting toward embedded finance partnerships.

* **Implementation**: Package the app's behavior-tracking, gamification, and restructuring tools as white-label solutions or SDK integrations for lenders and refinancing institutions. Use the behavioral data gathered from these modules to refine underwriting algorithms for refinancing loans.  
* **Impact**: Eliminates high customer acquisition costs, aligns platform monetization with lower default rates, and turns debt-repayment features into valuable customer retention assets.

#### **Works cited**

1\. Consumer Financial Behavior | Foundations and Trends in Marketing | Emerald Publishing, https://www.emerald.com/ftmkt/article/7/4/231/1324779/Consumer-Financial-Behavior 2\. Understanding the impact of borrowers' behavioural and psychological traits on credit default: review and conceptual model \- Emerald Insight, https://www.emerald.com/rbf/article/15/2/205/364912/Understanding-the-impact-of-borrowers-behavioural 3\. Behavioral intention, personality and consumer credit use \- Diva-Portal.org, https://www.diva-portal.org/smash/get/diva2:1909030/FULLTEXT01.pdf 4\. Debt strategy comparison: Avalanche or snowball? \- UMB Blog, https://blog.umb.com/debt-strategy-comparison-avalanche-snowball/ 5\. Debt Snowball vs Debt Avalanche: Which Strategy Gets You Out of Debt? \- PocketGuard, https://pocketguard.com/blog/debt-snowball-vs-debt-avalanche/ 6\. Full article: Behavioral biases and over-indebtedness in consumer credit: evidence from Malaysia \- Taylor & Francis, https://www.tandfonline.com/doi/full/10.1080/23322039.2024.2449191 7\. Choosing a Repayment Strategy: Debt Snowball vs Avalanche \- Sallie Mae, https://www.salliemae.com/blog/debt-snowball-vs-avalanche/ 8\. Debt snowball method vs. debt avalanche method: Which is right for you? | Fidelity, https://www.fidelity.com/learning-center/personal-finance/avalanche-snowball-debt 9\. Debt snowball method \- Wikipedia, https://en.wikipedia.org/wiki/Debt\_snowball\_method 10\. Debt snowball method \- what is it? \- Spergel, https://www.spergel.ca/learning-centre/debt-snowball-method/ 11\. Repayment Concentration and Consumer Motivation to Get Out of Debt \- Oxford Academic, https://academic.oup.com/jcr/article-pdf/43/3/460/17931827/ucw037.pdf 12\. The secret to paying off credit card debt | Folio \- University of Alberta, https://www.ualberta.ca/en/folio/2017/01/the-secret-to-paying-off-credit-card-debt.html 13\. Keri Kettle \- University of Miami | Marketing & Consumer Studies, https://www.uoguelph.ca/mcs/events/2013/06/keri-kettle-university-miami 14\. Repayment Concentration and Consumer Motivation to Get Out of Debt \- IDEAS/RePEc, https://ideas.repec.org/a/oup/jconrs/v43y2016i3p460-477..html 15\. Snowball vs. Avalanche Method for Paying Down Debt | Navy Federal Credit Union, https://www.navyfederal.org/makingcents/credit-debt/snowball-vs-avalanche-for-paying-down-debt.html 16\. Tally Technologies \- Wikipedia, https://en.wikipedia.org/wiki/Tally\_Technologies 17\. Dynamic Pricing in Business Lending: How AI Enables Smarter Rate, https://www.uptiq.ai/blogs/clientlending-blog-dynamic-pricing-in-business-lending 18\. Credit Card Debt Puzzle: Liquid Assets to Pay Bills \- Federal Reserve Bank of Boston, https://www.bostonfed.org/publications/research-department-working-paper/2022/credit-card-debt-puzzle-liquid-assets-to-pay-bills.aspx 19\. Coholding Puzzle: New Evidence from Transaction-Level Data | The Review of Financial Studies | Oxford Academic, https://academic.oup.com/rfs/advance-article/doi/10.1093/rfs/hhae016/7665718 20\. Untangling the credit card debt puzzle \- FDIC, https://www.fdic.gov/system/files/2024-09/2020-vihriala.pdf 21\. Intra-household Frictions, Anchoring, and the Credit Card Debt Puzzle \- Aalto Research Portal, https://research.aalto.fi/files/97569734/credit\_card\_puzzle.pdf 22\. How Mental Accounting Shapes Our Financial Choices \- Federal Reserve Bank of St. Louis, https://www.stlouisfed.org/publications/page-one-economics/2026/apr/how-mental-accounting-shapes-our-financial-choices 23\. The ostrich effect: when we hide from our finances \- Banco Santander, https://www.santander.com/en/stories/the-ostrich-effect-when-we-hide-from-our-finances 24\. Ostrich Effect \- The Decision Lab, https://thedecisionlab.com/biases/ostrich-effect 25\. Present bias, mental budget constraint, and the payday consumption cycle \- IDEAS/RePEc, https://ideas.repec.org/a/eee/chieco/v89y2025ics1043951x24001950.html 26\. The red and the black: mental accounting of savings and debt \- Carnegie Mellon University, https://www.cmu.edu/dietrich/sds/docs/loewenstein/redblack.pdf 27\. 5 Best Debt Payoff Planner Apps \- YNAB, https://www.ynab.com/blog/5-best-apps-to-help-pay-off-debt 28\. The Best Debt Payoff Apps of 2022 \- Experian, https://www.experian.com/blogs/ask-experian/best-apps-for-paying-off-debt/ 29\. Tally Was a Feature \- Fintech Takes, https://fintechtakes.com/articles/2024-10-14/tally-was-a-feature/ 30\. Leverage or Bias? The Debt Behavior of High-Income Consumers \- MDPI, https://www.mdpi.com/2227-7072/13/4/238 31\. Biz Analyst App for Tally User \- App Store \- Apple, https://apps.apple.com/us/app/biz-analyst-app-for-tally-user/id1164789740?l=es-MX 32\. How to Pay Off Debt Fast Using Gamification \- Credit Counselling Society, https://nomoredebts.org/blog/dealing-with-debt/how-to-use-gamification-to-pay-off-debt-faster