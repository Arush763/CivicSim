import type { IssueCategory } from '@mamdani/shared';

const EXACT: Record<string, IssueCategory> = {
  'Street Condition': 'street_condition',
  'Sidewalk Condition': 'street_condition',
  'Street Light Condition': 'street_condition',
  'Curb Condition': 'street_condition',
  'Highway Condition': 'street_condition',
  Obstruction: 'street_condition',

  'HEAT/HOT WATER': 'heat_hot_water',

  'UNSANITARY CONDITION': 'sanitation',
  'Dirty Condition': 'sanitation',
  'Illegal Dumping': 'sanitation',
  'Missed Collection': 'sanitation',
  Rodent: 'sanitation',
  'Litter Basket Request': 'sanitation',
  'Residential Disposal Complaint': 'sanitation',
  'Commercial Disposal Complaint': 'sanitation',
  Graffiti: 'sanitation',
  'Dead Animal': 'sanitation',

  'Traffic Signal Condition': 'traffic_safety',
  Traffic: 'traffic_safety',
  'Bike/Roller/Skate': 'traffic_safety',
  'For Hire Vehicle Complaint': 'traffic_safety',
  'Taxi Complaint': 'traffic_safety',

  'Illegal Parking': 'parking',
  'Blocked Driveway': 'parking',
  'Abandoned Vehicle': 'parking',
  'Derelict Vehicles': 'parking',
  'Abandoned Bike': 'parking',

  'Damaged Tree': 'trees_parks',
  'Dead/Dying Tree': 'trees_parks',
  'Illegal Tree Damage': 'trees_parks',
  'Overgrown Tree/Branches': 'trees_parks',
  'New Tree Request': 'trees_parks',
  'Maintenance or Facility': 'trees_parks',
  'Violation of Park Rules': 'trees_parks',
  'Animal in a Park': 'trees_parks',

  PLUMBING: 'housing_condition',
  'PAINT/PLASTER': 'housing_condition',
  'WATER LEAK': 'housing_condition',
  GENERAL: 'housing_condition',
  'DOOR/WINDOW': 'housing_condition',
  ELECTRIC: 'housing_condition',
  'FLOORING/STAIRS': 'housing_condition',
  APPLIANCE: 'housing_condition',
  SAFETY: 'housing_condition',
  Elevator: 'housing_condition',
  'General Construction/Plumbing': 'housing_condition',
  Lead: 'housing_condition',
  'Indoor Air Quality': 'housing_condition',

  Encampment: 'homelessness',
  'Homeless Person Assistance': 'homelessness',
  Panhandling: 'homelessness',
};

export function categorize(complaintType: string): IssueCategory {
  if (EXACT[complaintType]) return EXACT[complaintType];
  if (complaintType.startsWith('Noise')) return 'noise';
  if (complaintType.startsWith('Street Sign')) return 'traffic_safety';
  return 'other';
}
