package com.expenseflow.seed;

import java.util.Random;
import java.util.Set;

/** Synthetic name pools for the seed. None of these refer to real people or accounts. */
final class SeedNames {
    private SeedNames() {
    }

    static final String[] FIRST = {"Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan",
            "Krishna", "Ishaan", "Ananya", "Diya", "Aadhya", "Saanvi", "Myra", "Anika", "Pari", "Ira", "Navya",
            "Meera", "Rohit", "Priya", "Neha", "Rahul", "Sneha", "Karan", "Pooja", "Vikram", "Divya", "Nikhil",
            "Shreya", "Manish", "Kavya", "Siddharth", "Tanvi", "Harsh", "Riya", "Varun", "Aditi", "Yash"};

    static final String[] LAST = {"Sharma", "Verma", "Iyer", "Rao", "Nair", "Reddy", "Patel", "Shah", "Gupta",
            "Mehta", "Joshi", "Kulkarni", "Desai", "Menon", "Pillai", "Bose", "Banerjee", "Chatterjee", "Singh",
            "Kapoor", "Malhotra", "Agarwal", "Bhat", "Hegde", "Srinivasan", "Krishnan", "Das", "Mishra", "Pandey",
            "Saxena"};

    static final String[] CITIES = {"Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad", "Kolkata", "Pune",
            "Ahmedabad", "Indore", "Jaipur", "Lucknow", "Kochi", "Nagpur", "Coimbatore", "Bhopal", "Surat"};

    private static final Set<String> TIER_1 = Set.of("Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad",
            "Kolkata", "Pune", "Ahmedabad");

    static final String[] TITLES = {"Client visit", "Sales meeting", "Team offsite", "Vendor audit",
            "Training workshop", "Customer onboarding", "Site inspection", "Partner summit", "Recruitment drive",
            "Quarterly review", "Product demo", "Conference"};

    private static final String[] MEAL = {"Cafe Aroma", "Spice Route", "Udupi Bhavan", "Saravana Kitchen",
            "Punjab Grill House", "Coastal Curry Co", "Biryani Junction", "Green Leaf Diner", "Masala Corner"};
    private static final String[] CAB = {"CityRide Cabs", "MetroCab", "QuickTaxi", "Swift Wheels", "Airport Shuttle Co"};
    private static final String[] HOTEL = {"Residency Inn", "Grand Palms Hotel", "Lotus Suites", "Harbour View Hotel",
            "Comfort Stay", "Royal Orchid Lodge", "Blue Lagoon Residency"};
    private static final String[] OTHER = {"Stationery Hub", "Print Point", "Tech Bazaar", "Courier Express",
            "Book Depot", "Office Mart"};
    private static final String[] BIG = {"SkyJet Airways", "Rail Connect", "Expo Centre Registration",
            "Summit Conference Fees", "AirLink Travels"};

    static boolean isTier1(String city) {
        return TIER_1.contains(city);
    }

    static String vendor(Random rnd, String kind) {
        String[] pool = switch (kind) {
            case "MEAL" -> MEAL;
            case "CAB" -> CAB;
            case "HOTEL" -> HOTEL;
            case "BIG" -> BIG;
            default -> OTHER;
        };
        return pool[rnd.nextInt(pool.length)];
    }

    /** Small synthetic PNG-signature blob; unique bytes per receipt. */
    static byte[] receiptBytes(Random rnd) {
        byte[] b = new byte[96 + rnd.nextInt(160)];
        rnd.nextBytes(b);
        byte[] magic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        System.arraycopy(magic, 0, b, 0, magic.length);
        return b;
    }
}
