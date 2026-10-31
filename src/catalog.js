// Catálogos para generar seudónimos verosímiles (Colombia) y listas de conservación.

export const FEMALE = [
  'Sofía', 'Valeria', 'Mariana', 'Gabriela', 'Natalia', 'Paula', 'Carolina', 'Alejandra', 'Diana', 'Lorena',
  'Marcela', 'Liliana', 'Norma', 'Doris', 'Gloria', 'Patricia', 'Sandra', 'Claudia', 'Mónica', 'Adriana',
  'Ximena', 'Viviana', 'Tatiana', 'Johana', 'Lina', 'Elena', 'Victoria', 'Manuela', 'Antonia', 'Salomé',
  'Luciana', 'Martina', 'Isabella', 'Daniela', 'Catalina', 'Andrea', 'Angélica', 'Rocío', 'Pilar', 'Esperanza',
  'Rosa', 'Teresa', 'Margarita', 'Miryam', 'Olga', 'Stella', 'Yolanda', 'Marta', 'Inés', 'Carmen',
  'Lucía', 'Ana', 'Sara', 'Silvana', 'Milena', 'Jimena', 'Rebeca', 'Regina', 'Aurora', 'Celia',
  'Constanza', 'Fabiola', 'Gisela', 'Hilda', 'Irene', 'Leonor', 'Matilde', 'Nubia', 'Ofelia', 'Piedad',
  'Raquel', 'Susana', 'Tania', 'Vanesa', 'Wendy', 'Zulma', 'Alba', 'Berta', 'Cecilia', 'Dora',
];

export const MALE = [
  'Hugo', 'Sergio', 'Jorge', 'Ricardo', 'Fernando', 'Mauricio', 'Germán', 'Hernán', 'Óscar', 'Alberto',
  'Rodrigo', 'Gustavo', 'Javier', 'Álvaro', 'Eduardo', 'Rafael', 'Arturo', 'Enrique', 'Gabriel', 'Manuel',
  'Ignacio', 'Rubén', 'Guillermo', 'Héctor', 'Raúl', 'Iván', 'Camilo', 'Santiago', 'Tomás', 'Martín',
  'Simón', 'Emiliano', 'Joaquín', 'Lucas', 'Matías', 'Alejandro', 'Diego', 'Felipe', 'Julio', 'César',
  'Orlando', 'Wilson', 'Edwin', 'Fabio', 'Gilberto', 'Humberto', 'Jairo', 'Marco', 'Néstor',
  'Octavio', 'Pablo', 'Reinaldo', 'Saúl', 'Ulises', 'Víctor', 'Wilmer', 'Alonso', 'Bernardo', 'Cristian',
  'Darío', 'Elkin', 'Gonzalo', 'Horacio', 'Jaime', 'Leonardo', 'Mario', 'Nelson', 'Omar',
  'Rolando', 'Teodoro', 'Vicente', 'Aníbal', 'Benito', 'Ciro', 'Dagoberto', 'Efraín', 'Fausto', 'Gerardo',
];

export const SURNAMES = [
  'Zambrano', 'Pardo', 'Pineda', 'Cano', 'Lozano', 'Naranjo', 'Jaramillo', 'Valencia', 'Arias', 'Bermúdez',
  'Cárdenas', 'Duque', 'Escobar', 'Franco', 'Galeano', 'Hurtado', 'Ibarra', 'Lara', 'Medina', 'Nieto',
  'Orozco', 'Peña', 'Quiroga', 'Rincón', 'Sierra', 'Trujillo', 'Uribe', 'Vélez', 'Yepes', 'Zuluaga',
  'Acosta', 'Barrera', 'Cifuentes', 'Delgado', 'Espinosa', 'Fajardo', 'Guzmán', 'Herrera', 'Jiménez', 'León',
  'Mora', 'Navarro', 'Ortega', 'Patiño', 'Quintana', 'Rivera', 'Salcedo', 'Tovar', 'Urrego', 'Vargas',
  'Agudelo', 'Bedoya', 'Cuartas', 'Echeverri', 'Florez', 'Gaviria', 'Henríquez', 'Isaza', 'Londoño', 'Marín',
  'Noreña', 'Ochoa', 'Palacio', 'Restrepo', 'Saldarriaga', 'Toro', 'Usma', 'Villa', 'Arbeláez', 'Builes',
  'Cadavid', 'Díez', 'Estrada', 'Gallego', 'Hincapié', 'Idárraga', 'Llano', 'Montes', 'Ocampo', 'Posada',
  'Ramírez', 'Suárez', 'Tamayo', 'Vallejo', 'Aguirre', 'Benítez', 'Castillo', 'Durán', 'Figueroa', 'Gil',
  'Ángel', 'Becerra', 'Carvajal', 'Dávila', 'Forero', 'Garzón', 'Hoyos', 'Mesa', 'Niño', 'Parra',
];

// Nombres femeninos que no terminan en "a" y masculinos que sí, para inferir género.
export const FEMALE_EXTRA = new Set([
  'isabel', 'raquel', 'carmen', 'ines', 'pilar', 'luz', 'mercedes', 'dolores', 'beatriz', 'ruth', 'esther',
  'yasmin', 'miriam', 'lourdes', 'marisol', 'consuelo', 'rocio', 'belen', 'abigail', 'jazmin', 'ingrid',
  'astrid', 'karen', 'lizeth', 'yuliet', 'nicole', 'ivonne', 'edith', 'gladys', 'doris', 'maribel', 'soledad',
  'flor', 'ruby', 'shirley', 'mabel', 'nathaly', 'leidy', 'sharon', 'salome', 'celeste', 'nohemi', 'yamile',
  'yuleidy', 'aracely', 'zoe', 'noemi', 'margot', 'ximena', 'jimena', 'nubia', 'stella', 'esperanza', 'adel',
]);
export const MALE_A = new Set(['nicola', 'luca', 'josua', 'joshua', 'garcia', 'bautista', 'elias', 'jhoan']);

// Ocupación → sector (generalización de cuasi-identificador).
export const SECTOR = {
  'abogada': 'profesional del derecho', 'abogado': 'profesional del derecho',
  'administrador': 'profesional de la administración', 'administradora': 'profesional de la administración',
  'arquitecta': 'profesional de la construcción', 'arquitecto': 'profesional de la construcción',
  'auxiliar contable': 'profesional de finanzas', 'contador': 'profesional de finanzas', 'contadora': 'profesional de finanzas',
  'chef': 'profesional de la gastronomía', 'panadero': 'profesional de la gastronomía', 'panadera': 'profesional de la gastronomía',
  'comerciante': 'profesional del comercio',
  'community manager': 'profesional de medios', 'periodista': 'profesional de medios',
  'conductor de plataforma': 'profesional del transporte', 'piloto comercial': 'profesional del transporte', 'conductora de plataforma': 'profesional del transporte',
  'diseñador gráfico': 'profesional de las industrias creativas', 'diseñadora gráfica': 'profesional de las industrias creativas',
  'fotógrafa': 'profesional de las industrias creativas', 'fotógrafo': 'profesional de las industrias creativas',
  'docente': 'profesional de la educación',
  'electricista': 'profesional de oficios técnicos', 'mecánico': 'profesional de oficios técnicos', 'mecánica': 'profesional de oficios técnicos',
  'enfermera': 'profesional de la salud', 'enfermero': 'profesional de la salud', 'fisioterapeuta': 'profesional de la salud',
  'odontóloga': 'profesional de la salud', 'odontólogo': 'profesional de la salud', 'psicóloga': 'profesional de la salud', 'psicólogo': 'profesional de la salud',
  'veterinaria': 'profesional de la salud', 'veterinario': 'profesional de la salud',
  'estilista': 'profesional de servicios',
  'estudiante de derecho': 'estudiante universitario', 'estudiante de medicina': 'estudiante universitario',
  'ingeniera de sistemas': 'profesional de ingeniería', 'ingeniero de sistemas': 'profesional de ingeniería', 'ingeniero civil': 'profesional de ingeniería', 'ingeniera civil': 'profesional de ingeniería',
};

export const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga', 'Pereira', 'Manizales', 'Cúcuta', 'Ibagué', 'Santa Marta', 'Villavicencio', 'Pasto', 'Neiva', 'Armenia', 'Montería'];

// Organizaciones, lugares, marcas y figuras públicas que se conservan tal cual.
export const KEEP = [
  'Kipu Pay', 'Kipu', 'Kipi', 'Bancolombia', 'Banco de Bogotá', 'Banco de Occidente', 'Davivienda', 'BBVA', 'Banco Popular',
  'Banco Caja Social', 'Banco Agrario', 'Scotiabank Colpatria', 'Colpatria', 'Itaú', 'Banco Falabella', 'Nequi', 'Daviplata',
  'Movii', 'Rappi', 'RappiPay', 'Lulo Bank', 'Nu', 'Nubank', 'PSE', 'Efecty', 'Baloto', 'Superfinanciera', 'Superintendencia Financiera',
  'DataCrédito', 'Datacrédito', 'TransUnion', 'CIFIN', 'DIAN', 'Registraduría', 'Policía Nacional', 'Fiscalía', 'Carulla', 'Éxito',
  'Olímpica', 'Jumbo', 'Falabella', 'Alkosto', 'Homecenter', 'D1', 'Ara', 'Unicentro', 'Andino', 'Santafé', 'Plaza Botero',
  'Juan Valdez', 'Parque Lleras', 'Parque 93', 'Zona T', 'Andrés Carne de Res', 'Crepes & Waffles', 'Frisby', 'El Corral',
  'Veloz', 'Servientrega', 'Coordinadora', 'Interrapidísimo', 'Uber', 'DiDi', 'Avianca', 'Visa', 'Mastercard', 'Claro', 'Movistar',
  'Tigo', 'WhatsApp', 'Slack', 'Google', 'Gmail', 'Shakira', 'Gabriel García Márquez', 'Fernando Botero', 'Juanes', 'Karol G',
  'Maluma', 'J Balvin', 'Nairo Quintana', 'Sofía Vergara', 'Carlos Vives', 'James Rodríguez', 'Egan Bernal', 'Radamel Falcao', 'Iván Duque', 'Álvaro Uribe', 'Francia Márquez', 'Claudia López', 'Feid', 'Fonseca', 'Gustavo Petro', 'Los Andes', 'Universidad de los Andes', 'Javeriana', 'Universidad Nacional', 'Estación Restrepo',
  'Santander', 'Banco Santander', 'Bolívar', 'Antioquia', 'Cundinamarca', 'Valle del Cauca', 'Atlántico', 'Risaralda',
  ...CITIES,
];

export const STREET_TYPES = ['Calle', 'Carrera', 'Cra', 'Cl', 'Av', 'Diagonal', 'Transversal', 'Tv', 'Kr'];
