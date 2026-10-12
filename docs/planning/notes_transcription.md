# Handwritten Notes Transcription

---

## Page 1

A user should know what type of loan he has. → Not possible yeah?

**i) Floating Loans** → Usually for long term ones
Like home loan are floating - No prepayment (ets)
So if better rates exist we can suggest Foreclosure penalties exist
foreclosure.

**ii) Fixed loans** → Usually for short term loans
Like personal loans → Tenure of 0 - 7 yrs.

4) Banks will charge penalty if they find
that the prepayment amount was from
Balance Transfer / Refinancing for such
type of loans → Penalty of 2-4%
of amount prepaid

*Must research for top 3 banks charge as to what they charge*

So if I do a balance transfer to say get money
I mind from another bank to close this loan then
2% - 4% varies by bank will be charged

---

## Page 2

For when we get a windfall amount we do not prepay
the emi → we ask the bank to close out the principal so
my emi for the next months could go down? → And
even this has limits like 25% of outstanding principal
& so forth before a penalty gets triggered?
Same for lock-in period type of loans?

What type of loan agreement a user has to Take up
→ Recommending this → Requires knowing what type of questions?
A guy with a business expecting a business to boom
from day 1 cannot be put into a Lock-in period type
of loans yeah.

So what do we ask the user & where do we ask
such questions becomes key.

Do we ask them to upload their KFS?
**(Q1)** loan agreement document? Should we
build a parser to interpret their specific contract rules?

Right now we ask user for Amount outstanding
& EMI monthly & from this I think we are
deriving certain values → Is this correct & accurate
for MVP **(Q1)** Should we integrate with Account Aggregator
to fetch details **(Q1)** is it not required for now?

Right now if I log in to paisabazaar using my
number & enter a few details it says & fetches possible
banks that I can switch to as in offers → Am I correct?
So integrating AA & with banks will be necessary
But where is my value proposition?

---

## Page 3

**(Q1) Savings in VS case**

Ideally I think, Emergency fund built up is
where any extra expense for a month should be
taken from. 50% of a month's salary with a
3 month buildup suggested. So a user sees a
fixed expense, surplus budget & subsequent allocation
across ef, emf & goals it my.

Activity tab should ideally ask for Actual expenses
for that month, EF balances Actual EMI payments
amounts compared to what was suggested, EF split
of 70% means balance should be xx enter actual

Instead you know expense, you know actual emi
amounts paid **(Q1)** logged whenever user marks as paid
Based on his date in 1st page (a small popup window
opens if user paid anything different) he can update
whenever this. And so we can derive expected allocation
to EF from this

Update your actual expenses, EMI payments actuals,
Your credit card payments ideally goes under where
EMI **(Q1)** are treat it as expense? Should remain
In open positions Tab this.

How do I take in Credit and part? Should I put it
as expenses + credit card spend → Is it spend we
Should ask in setup 3 month average credit card
spend & what about EMI? Or is it baked in?
And what would this section in Activity tab look The

---

## Page 4

because a user may pay more to close out his
credit card expense and also the user has such
humongous credit card expense should we prioritise
closing that down then start saving for EF?

~~Any recurring expenses~~

If RBI announces Repo rate change when exactly
would the RLLR based loans (Floating loans)
get updated?)

Reset period for RLLR says 3 months but
3 months from including the month of announcement?
MCLR says reset period of 6 months - 12 months
is it correct? And depends on various factors

The Transmission period costs money which is
why floating is better. Another thing RBI noted
banks to offer floating rate loans too?

### Research Questions

Plan for Building a home should be split into
many different sub sections like:

| Category | Amount |
|----------|--------|
| ex: Home = 15L | |
| Cement | 5L |
| Steel | 3L |
| Bricks | 2L |
| & so forth | |

Must ask for what savings they hold → Most have
idle assets → This is key to Tell them to liquidate those
along with the math

---

## Page 5

*Psychological victory is always preferred.*

---

### FOR PLAID INTEGRATION.
### MAJOR QUESTIONS:

**1)** I can Track all expenses, debts & future payment
dates for those (→ I need to know of prepayment
penalties **(Q1)** so if any exists)

i) Can I split the view as:
- I) This month's expense budget
- II) Income
- III) Surplus → xx

Show open positions & tell them what to pay off 1st.
Based on strategy selection & other stuff.

I do not know how Tax → Does employer hold of this
amount & only give it as Take home (or) how should
I describe this → If not & tax varies per state
then how should we model that part of assuming
tax isn't deducted at source, should user set aside some
monthly **(Q1)** at end of year considering his outstanding
debt payments & goals? What would be ideal
economic way of doing this.

**2)** Automated payments based on on user Strategy
selection is possible? → Splitting some money into
as emergency reserve bucket? & So, how would a
user tip into this? Ex: A user has set $49,000
as his expense budget for the month. And but he is
currently gonna overshoot this as $44,000 is already
spent by midmonth and has to top into emergency
reserve → So Is this like separate buckets?
He can use (or) have such split pools to tap into?

---

## Page 6

**3)** Restructure (or) Refinance decision → Apps like SoFi I
can help restructure multiple credit card debts & consolidate
into one → So there could be other segments of debts
& things so how do we integrate those? Or suggest
as ideas?

For Refinancing → In India banks got MCLR,
RLLR, Fixed rate varies on private banks, Public banks
I was in the middle of figuring out how to suggest
users that either their bank is overcharging them and
how much they could save → There was many clauses
like own funds clause & others that meant penalties
will be levied & not possible to switch unless loan
type was floating.

Similarly what sort of stuff exists in the US banking
scenario & how do we tackle such stuff over there
& suggest them wisely?

**4)** Investment & savings details can also be fetched
directly so we can recommend (or) home portfolio trackers
*[These are top ideas]*

**5)** Tools → Windfall or Bonus, Liquidating an asset →
Intelligent recommendations on where to liquidate for
tax benefits? Based on after tax on-hand amount calculation
for across many of these assets, one click diverting to
clean off debt & so forth.

a) What if sliders, other modellings like like, inflation,
letting user also manually input or add funds to a
goal regardless, all research questions being directed
& good for best implementation keys etc.

---

## Page 7

I find that in US mainly there checking a savings
account → So having money in savings account
earns some yield instead of keeping it idle in
emergency fund.

Also for fixed rate loans ideally it would be
easy for user to payoff just the required amount
each month instead of closing it early by any scenarios?

We discussed so many different key costs and
so forth for goals.

Intent is, Savings shall be updated how often?
& are they as in money in a savings account
instantly withdrawable?

Too much friction, without my app offering any
yield why would they use it?

Assume user sets 4000 dollars as expense budget
but ends up having to withdraw 2k dollars in
cash now what (or) how could he proven if
he didn't use up that cash?


The following are questions in general I did asked and had as side notes , research on these topics:
Research on prepayment penalties for every bank



You must maintain Minimum Account Balance so where do we ask him this, whether he follows (or) ensures this



Should we Ask for 3 month average Credit card spend to determine their expense for credit card since it is revlving ?(or) allocate that into expense bracket?



How do we represent this in open positions? Since this debt is revolving we can't really say the user to allocate this much to this yeah? So entire budgeting of expense, surplus and it’s subsequent allocation to goals and highest apr debts may get questionable no?

Activity ledger must have like a separate dedicated credit card window to model  this out? Like he may close his account in full – that’s a scenario and  how much he owes the next month? Do we need this? considering 3 months average?



Full Terms of Taking a loan → Floating loans. VS Fixed rate loans



Ideally user may not even know the type of loan he is, so pulling all bank loan details associated to the account is the way yeah? But how do I register?

For MVP we could assume the user knows his loan type?





  Paisabazaar kind of has those details perfectly?

Like how do we know e.g.: SBI says penalty of 0-4% principal, if prepayment in 6 months - 12 months.



Should I need to find benchmark rate? Is it like telling a user whether he is overpaying (or) not, so if he has put adequate surplus

Then instead of refinancing he should switch to a floating loan?



Like: Are there good suggestions (or)? Like building the engine [accurately?] is half the battle done in my opinion.



Like, Determining whether he is actually being charged more or less, But is this credit score dependent?  Other factors too?

Think of removing the ask for idle cash → Too much question more (or) less confusing. I'm assuming the state of a user signing up to this app on any particular day.

A user holding 50,00,000 still has his money compounding even if it sits in FD no? How could we say 'remove a pay off the interest instead' → Even if we suggest to remove and he accepts it → How do we define how much to remove → should goals also say

it goes (i) not → for hard constrained goals it should (or)



For goals we model this separately again? → Like assume user has hard constraint goal → But surplus could not fulfill that now we explore other options, yeah →

Have we list (a) (i) Savings: Top into savings  (ii) take a new loan (How do we suggest best possible ones?- I know paisabazaar has this?)  (iii) Liquidate assets —



And if we still rejects all else? Then we just like say only 75% of goal achievable & so so yeah?



The kind of loans & rates offered depends on whether user is salaried → Many other metrics → Paisabazaar may ask such questions before suggesting to take a loan (or)... If a user has a  Business then many questions like his turnover, gst registered (or) not, etc., Make sure to research this thoroughly.



Switching like from Salaried to Salaried + Business (or) Just business → Should he ideally have a dedicated account for his business? If unified then has the allocation, expense etc. would be too much no?


