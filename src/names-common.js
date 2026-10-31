// Nombres de pila y apellidos hispanos frecuentes. Solo sirven para DETECTAR personas que no están en el
// registro; los seudónimos salen de catalog.js. Minúsculas y sin tildes (como norm()).
export const COMMON_FIRST = `
aaron abel abelardo abraham adalberto adan adela adelaida adelina adolfo adrian adriana agustin agustina aida aide
alba albeiro alberto alcira aldemar alejandra alejandro alexander alexandra alexis alfonso alfredo alicia alirio
alma alonso alvaro amalia amanda amelia americo amparo ana anabel anderson andrea andres angel angela angelica
angie anibal antonia antonio araceli ariel armando arnulfo arturo astrid augusto aura aurelio aurora axel azucena
beatriz belen benjamin bernardo berta bertha betty blanca brayan brenda bruno camila camilo candelaria carina carla
carlos carmen carmenza carolina catalina cecilia celia cesar cielo cindy clara claudia clemencia consuelo constanza
cristian cristina cristobal dagoberto daira damaris dana daniel daniela dario david dayana debora deisy delia
diana diego dilan dolly dora doris duvan edgar edilberto edith edna eduardo edwar edward edwin efrain elena eliana
elias elisa elizabeth elkin elsa elvia elvira emilia emiliano emilio emma enrique erica erika ernesto esneider
esperanza estefania esteban estela ester esther eugenia eva evelio evelyn ezequiel fabian fabiola facundo fanny
federico felipe fernanda fernando fidel flor flora francisco franco freddy fredy gabriel gabriela gerardo german
gilberto gina giovanni gisela gladys gloria graciela gregorio guadalupe guillermo gustavo harold hector helena
heriberto hernan hernando hilda horacio hugo humberto ignacio ines ingrid irene iris isaac isabel isabela ismael
ivan ivonne jacinto jacobo jaime jairo janeth javier jazmin jenny jeronimo jessica jesus jhon jhonatan jhonny
jimena joaquin johana johanna john jonathan jorge jose josefina joseph juan juana julia julian juliana julieta
julio karen karina katherine kelly kevin lady laura leandro leidy leonardo leonel leonor leticia lida liliana lina
lisandro lizeth mary mery marlen lorena lucas lucia luciana lucy luis luisa luz magdalena manuel manuela marcela marcelo marcial marco
marcos margarita maria mariana maribel maricela marina mario marisol marlene marleny marlon martha martin martina
mateo matias mauricio maximo mayra melissa mercedes miguel milena miriam miryam moises monica nancy natalia
nathalia nayibe nelly nelson nestor nicolas nidia nohora nora norma octavio olga oliva omar orlando oscar osvaldo
pablo paola patricia paula paulina pedro pilar rafael ramiro ramon raquel raul rebeca regina reinaldo renata
ricardo roberto rocio rodolfo rodrigo rogelio rolando rosa rosalba rosario ruben ruth salome salomon samuel sandra
santiago sara sebastian sergio silvia simon sofia sonia stella stiven susana tatiana teresa tomas valentina valeria
vanesa vanessa veronica vicente victor victoria viviana walter wilmer william wilson ximena yamile yaneth yeison
yenny yesenia yesica yolanda yorman yuliana yurani zoraida zulma
`.trim().split(/\s+/);

export const COMMON_SUR = `
acevedo acosta agudelo aguilar aguirre alarcon alvarado alvarez amaya angel angulo aponte arango aranda arbelaez
arenas arevalo arias arango arrieta avila bahamon barbosa barrera barreto barrios bautista becerra bedoya beltran
benavides bermudez bernal betancourt betancur blanco bolivar bonilla borja botero bravo bueno buitrago builes
burbano bustamante bustos caballero cabrera cadavid caicedo calderon calle camacho campos cano cardenas cardona
carmona carranza carrasco carrillo castano castellanos castillo castro ceballos celis cespedes chacon chaparro
chavarria chaves chavez cifuentes cobo contreras cordoba correa cortes cruz cuellar daza delgado diaz dominguez
duarte duque duran echeverri escobar espinosa espinoza estrada fajardo fernandez figueroa florez fonseca forero
franco fuentes gaitan galeano galindo gallego gallo galvis gamboa garces garcia garzon gaviria gil giraldo gomez
gonzalez granados grisales guerrero guevara guzman henao herrera hernandez hincapie hoyos hurtado ibanez ibarra
isaza jaramillo jimenez lara leal leon lopez lozano lugo luna machado madrid manrique marin marquez martinez
marulanda medina mejia melo mendez mendoza meneses mesa mora morales moreno mosquera munoz murillo naranjo narvaez
navarro nieto nino noguera nunez ocampo ochoa ortega ortiz osorio ospina otalvaro pacheco padilla palacio palacios
palomino pardo paredes parra pereira patino pena peralta perez pineda pinto pinzon pizarro posada prada prieto puerta
quintero quiroga quiroz ramirez ramos rangel reyes rico rincon rios rivera robledo rodriguez rojas romero rosero
rubio rueda ruiz saavedra salamanca salas salazar salcedo saldarriaga salgado sanabria sanchez sandoval santamaria
santos sarmiento serna serrano sierra silva solano sosa suarez tabares tamayo tapia tellez tobon toro torres trujillo
uribe urrego valderrama valencia valero vallejo vanegas vargas vasquez vega velasco velasquez velez vergara villa
villamil villegas yepes zambrano zapata zarate zuluaga zuniga
`.trim().split(/\s+/);
