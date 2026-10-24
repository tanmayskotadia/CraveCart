/** Discovery locations, not a claim that delivery is active in these cities. */
export const cityDirectory = [
  { slug: 'mumbai', name: 'Mumbai', state: 'Maharashtra' },
  { slug: 'delhi', name: 'Delhi', state: 'Delhi' },
  { slug: 'bengaluru', name: 'Bengaluru', state: 'Karnataka' },
  { slug: 'hyderabad', name: 'Hyderabad', state: 'Telangana' },
  { slug: 'chennai', name: 'Chennai', state: 'Tamil Nadu' },
  { slug: 'pune', name: 'Pune', state: 'Maharashtra' },
  { slug: 'kolkata', name: 'Kolkata', state: 'West Bengal' },
  { slug: 'ahmedabad', name: 'Ahmedabad', state: 'Gujarat' },
  { slug: 'jaipur', name: 'Jaipur', state: 'Rajasthan' },
  { slug: 'kochi', name: 'Kochi', state: 'Kerala' },
  { slug: 'chandigarh', name: 'Chandigarh', state: 'Chandigarh' },
  { slug: 'lucknow', name: 'Lucknow', state: 'Uttar Pradesh' },
  { slug: 'indore', name: 'Indore', state: 'Madhya Pradesh' },
  { slug: 'surat', name: 'Surat', state: 'Gujarat' },
  { slug: 'coimbatore', name: 'Coimbatore', state: 'Tamil Nadu' },
  { slug: 'panaji', name: 'Panaji', state: 'Goa' },
  { slug: 'bhubaneswar', name: 'Bhubaneswar', state: 'Odisha' },
  { slug: 'thiruvananthapuram', name: 'Thiruvananthapuram', state: 'Kerala' },
] as const;
export type DiscoveryCity = (typeof cityDirectory)[number];
export const findCity = (slug: string | null | undefined) =>
  cityDirectory.find((city) => city.slug === slug);
export const nationalMarket = {
  country: 'IN',
  scope: 'national',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
} as const;
