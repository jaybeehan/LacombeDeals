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

# Restaurants
RFD_FEED = "https://forums.redflagdeals.com/feed/forum/9"

# Restaurants in Lacombe. "app" = the chain puts most of its deals in its own app.
LACOMBE_RESTAURANTS = [
    {"name": "A&W", "type": "Burgers", "app": True},
    {"name": "Booster Juice", "type": "Smoothies", "app": True},
    {"name": "Boston Pizza", "type": "Pizza & pub"},
    {"name": "Brunch Glory", "type": "Breakfast & brunch"},
    {"name": "Buster's Pizza & Donair", "type": "Pizza & donair"},
    {"name": "Dairy Queen", "type": "Ice cream & burgers", "app": True},
    {"name": "Domino's", "type": "Pizza", "app": True},
    {"name": "Edo Japan", "type": "Japanese", "app": True},
    {"name": "KFC", "type": "Chicken", "app": True},
    {"name": "Lacombe Bar And Steakhouse", "type": "Pub & steakhouse"},
    {"name": "McDonald's", "type": "Burgers", "app": True},
    {"name": "Mr. Mike's", "type": "Steakhouse"},
    {"name": "Oishii Japanese Cuisine", "type": "Sushi"},
    {"name": "Panago", "type": "Pizza", "app": True},
    {"name": "Pizza Hut", "type": "Pizza", "app": True},
    {"name": "Red Swan Pizza", "type": "Pizza"},
    {"name": "Starbucks", "type": "Coffee", "app": True},
    {"name": "Subway", "type": "Subs", "app": True},
    {"name": "Sweet Capone's", "type": "Italian bakery"},
    {"name": "Tasty Bites", "type": "Indian & pizza"},
    {"name": "The 1947 Indian Restaurant", "type": "Indian"},
    {"name": "Tim Hortons", "type": "Coffee & donuts", "app": True},
    {"name": "Triple O's", "type": "Burgers"},
    {"name": "Wendy's", "type": "Burgers", "app": True},
]

# Chains to recognise in RedFlagDeals posts (Lacombe ones are shown first)
CHAINS = [
    "McDonald's", "McDonalds", "Tim Hortons", "Tims", "A&W", "Burger King", "Wendy's", "KFC", "Subway",
    "Pizza Hut", "Domino's", "Dominos", "Little Caesars", "Papa John's", "Pizza Pizza", "Pizza 73",
    "Boston Pizza", "Panago", "Dairy Queen", "Starbucks", "Popeyes", "Harvey's",
    "Swiss Chalet", "Mary Brown's", "Taco Bell", "Taco Time", "Chipotle", "Five Guys",
    "Freshii", "Booster Juice", "Edo Japan", "Triple O's", "White Spot", "Denny's",
    "Montana's", "East Side Mario's", "Earls", "Moxies", "Cactus Club", "Kelseys",
    "Red Lobster", "Olive Garden", "Applebee's", "IHOP", "Chick-fil-A", "Wingstop",
    "Osmow's", "Mucho Burrito", "Quesada", "Barburrito", "Second Cup", "Krispy Kreme",
    "Cora", "Smitty's", "Humpty's", "Ricky's", "Original Joe's", "Browns Socialhouse",
    "Mr. Mike's", "Mr Mikes", "Fatburger", "Nando's", "Jollibee", "Church's",
    "Opa!", "Pita Pit", "Jugo Juice", "Menchie's", "Cinnabon", "Marble Slab",
    "Shake Shack", "Panera", "St-Hubert", "Thai Express", "Manchu Wok",
]
# Posts about these are skipped entirely
DELIVERY_WORDS = ["uber eats", "ubereats", "uber one", "doordash", "door dash", "dashpass",
                  "skipthedishes", "skip the dishes", "skip+", "instacart", "delivery fee"]
