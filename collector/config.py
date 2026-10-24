"""Settings for the collector. Edit and push to change what gets tracked."""

POSTAL_CODE = "T4L2N3"          # Lacombe, AB
TOWN = "Lacombe"

# Stores with a location in Lacombe itself. Everything else Flipp shows for the
# postal code is labelled "Nearby" (mostly Red Deer). The page lets you filter.
LACOMBE_STORES = {"Sobeys", "Safeway", "No Frills", "Walmart", "Co-op",
                  "Shoppers Drug Mart"}

# Grocery-category flyers to ignore completely
SKIP_MERCHANTS = {"Real Canadian Liquor Store", "Sobeys & Safeway Liquor", "Pet Valu"}

# Everything searched every run. Each search returns every matching flyer item
# from every store, with proper per-lb / per-100 g pricing, and builds price history.
# Anything you add to your watchlist on the page is matched against these results
# (plus the full flyer listings), so broad words here = better coverage.
DEPARTMENTS = {
    "Meat & seafood": ["chicken breast", "chicken thighs", "chicken drumsticks", "whole chicken",
                       "chicken wings", "ground beef", "steak", "roast", "stewing beef", "pork chops",
                       "pork tenderloin", "pork loin", "ribs", "ground pork", "ground turkey", "bacon",
                       "ham", "sausage", "hot dogs", "deli meat", "salmon", "shrimp", "fish", "turkey"],
    "Dairy & eggs": ["milk", "eggs", "butter", "cheese", "cheddar", "mozzarella", "yogurt",
                     "greek yogurt", "cream", "sour cream", "cream cheese", "ice cream", "margarine"],
    "Bakery & breakfast": ["bread", "bagels", "tortillas", "buns", "english muffins", "cereal",
                           "oatmeal", "pancake", "waffles", "peanut butter", "jam"],
    "Produce": ["bananas", "apples", "oranges", "grapes", "strawberries", "blueberries", "avocado",
                "potatoes", "onions", "carrots", "lettuce", "tomatoes", "cucumber", "peppers",
                "broccoli", "mushrooms", "celery", "corn", "salad"],
    "Pantry & snacks": ["pasta", "pasta sauce", "rice", "flour", "sugar", "cooking oil", "olive oil",
                        "soup", "canned tomatoes", "beans", "tuna", "mac and cheese", "ketchup",
                        "mayonnaise", "crackers", "cookies", "chips", "granola bars", "nuts", "popcorn"],
    "Frozen": ["frozen pizza", "frozen vegetables", "frozen fries", "chicken nuggets", "perogies",
               "lasagna", "frozen fruit"],
    "Drinks": ["coffee", "k-cups", "tea", "juice", "pop", "soft drinks", "water", "sparkling water"],
    "Household & personal": ["toilet paper", "paper towels", "laundry detergent", "dish soap",
                             "dishwasher", "garbage bags", "toothpaste", "shampoo", "deodorant",
                             "diapers"],
}
STAPLES = [q for qs in DEPARTMENTS.values() for q in qs]
DEPT_OF = {q: d for d, qs in DEPARTMENTS.items() for q in qs}

# Categories (Flipp's _L1) that count as groceries for "Top deals"
FOOD_L1 = {"Food, Beverages & Tobacco"}
HOUSEHOLD_L2 = {"Household Supplies", "Personal Care", "Paper Products", "Laundry",
                "Cleaning Supplies", "Health & Beauty"}

# Restaurant / delivery sources
UBER_EATS_URL = "https://www.ubereats.com/ca/city/lacombe-ab"
DOORDASH_URL = "https://www.doordash.com/en/food-delivery/lacombe-ab-restaurants/"
RFD_FEED = "https://forums.redflagdeals.com/feed/forum/9"

# Chains to recognise in RedFlagDeals posts. Ones that also appear on the Uber Eats
# Lacombe page are marked "In Lacombe" automatically.
CHAINS = [
    "McDonald's", "Tim Hortons", "A&W", "Burger King", "Wendy's", "KFC", "Subway",
    "Pizza Hut", "Domino's", "Little Caesars", "Papa John's", "Pizza Pizza", "Pizza 73",
    "Boston Pizza", "Panago", "Dairy Queen", "Starbucks", "Popeyes", "Harvey's",
    "Swiss Chalet", "Mary Brown's", "Taco Bell", "Taco Time", "Chipotle", "Five Guys",
    "Freshii", "Booster Juice", "Edo Japan", "Triple O's", "White Spot", "Denny's",
    "Montana's", "East Side Mario's", "Earls", "Moxies", "Cactus Club", "Kelseys",
    "Red Lobster", "Olive Garden", "Applebee's", "IHOP", "Chick-fil-A", "Wingstop",
    "Osmow's", "Mucho Burrito", "Quesada", "Barburrito", "Second Cup", "Krispy Kreme",
    "Cora", "Smitty's", "Humpty's", "Ricky's", "Original Joe's", "Browns Socialhouse",
    "Mr. Mike's", "Mr Mikes", "Fatburger", "Nando's", "Jollibee", "Church's",
    "Buster's Pizza", "Red Swan", "Opa!", "Pita Pit", "Jugo Juice", "Menchie's",
    "Cinnabon", "Wing Machine", "Tropical Smoothie", "Marble Slab", "Dominos",
    "Shake Shack", "Panera", "St-Hubert", "Thai Express", "Manchu Wok", "Sushi",
]
DELIVERY_APPS = {
    "Uber Eats": ["uber eats", "ubereats", "uber one"],
    "DoorDash": ["doordash", "door dash", "dashpass"],
    "SkipTheDishes": ["skipthedishes", "skip the dishes", "skip "],
    "Instacart": ["instacart"],
}
FOOD_WORDS = ["restaurant", "pizza", "burger", "fries", "combo", "meal deal", "free food",
              "coupon", "bogo", "wings", "sandwich", "coffee", "donut", "taco", "sub "]
