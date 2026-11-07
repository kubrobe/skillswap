-- Skill catalog (reference data). Demo users/offers are added by db/seed.js.
INSERT INTO categories (name) VALUES
  ('Programming'), ('Languages'), ('Design'), ('Music'), ('Fitness & Sport'), ('Business & Study'), ('Cooking & Crafts');

INSERT INTO skills (category_id, name) VALUES
  ((SELECT id FROM categories WHERE name='Programming'), 'Python basics'),
  ((SELECT id FROM categories WHERE name='Programming'), 'Web development (HTML/CSS)'),
  ((SELECT id FROM categories WHERE name='Programming'), 'SQL and databases'),
  ((SELECT id FROM categories WHERE name='Programming'), 'JavaScript'),
  ((SELECT id FROM categories WHERE name='Programming'), 'Excel and data analysis'),
  ((SELECT id FROM categories WHERE name='Languages'),   'English conversation'),
  ((SELECT id FROM categories WHERE name='Languages'),   'IELTS writing'),
  ((SELECT id FROM categories WHERE name='Languages'),   'Korean for beginners'),
  ((SELECT id FROM categories WHERE name='Languages'),   'Russian'),
  ((SELECT id FROM categories WHERE name='Design'),      'UI design in Figma'),
  ((SELECT id FROM categories WHERE name='Design'),      'Photo editing'),
  ((SELECT id FROM categories WHERE name='Design'),      'Video editing'),
  ((SELECT id FROM categories WHERE name='Music'),       'Guitar'),
  ((SELECT id FROM categories WHERE name='Music'),       'Piano'),
  ((SELECT id FROM categories WHERE name='Fitness & Sport'), 'Gym training basics'),
  ((SELECT id FROM categories WHERE name='Fitness & Sport'), 'Chess'),
  ((SELECT id FROM categories WHERE name='Fitness & Sport'), 'Running for beginners'),
  ((SELECT id FROM categories WHERE name='Business & Study'), 'Public speaking'),
  ((SELECT id FROM categories WHERE name='Business & Study'), 'Presentation design'),
  ((SELECT id FROM categories WHERE name='Business & Study'), 'Academic writing'),
  ((SELECT id FROM categories WHERE name='Cooking & Crafts'), 'Cooking plov'),
  ((SELECT id FROM categories WHERE name='Cooking & Crafts'), 'Baking'),
  ((SELECT id FROM categories WHERE name='Cooking & Crafts'), 'Calligraphy');
