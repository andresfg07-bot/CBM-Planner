Actúa como un Arquitecto de Software y Desarrollador Full-Stack experto. >
Mi objetivo es crear una aplicación web interna que reemplace mi archivo maestro de Excel, con el cual controlo la operación, el presupuesto y la ejecución del departamento de CBM en A-MAQ. Esta área es neurálgica para el flujo de caja de la empresa, por lo que la aplicación debe ser robusta, fácil de visualizar y orientada al control de estados.

A continuación, detallo la lógica de negocio actual, los procesos manuales que realizo y los nuevos requerimientos que deseo implementar. Tu tarea es analizar esta información y entregarme:

La arquitectura recomendada para esta aplicación.

El modelo de la base de datos (entidades y relaciones).

El diseño conceptual de la interfaz de usuario (qué vistas o tableros necesito).

Un plan de desarrollo paso a paso para comenzar a programarla.

1. Entidades Principales del Sistema:

Clientes: Tienen diferentes comportamientos (fijos, difíciles de agendar, propensos a reagendar).

Analistas: Tienen disponibilidad variable, nivel de confianza con ciertos clientes y conocimiento específico de ciertas plantas.

Equipos de medición: Tienen control de disponibilidad/ocupación.

Servicios/Gestiones: Cada trabajo proyectado con un valor presupuestado asociado.

2. Flujo de Trabajo y Reglas de Negocio (Mensual/Semanal):

Planificación: A inicio de mes, cargo las proyecciones de ingresos (posibles gestiones facturables). Debo poder visualizar estas gestiones sin asignar y arrastrarlas a un cronograma.

Estrategia de Agendamiento: El sistema debe permitirme organizar estratégicamente a los clientes. Ejemplo: agendar a principio de mes a los de facturación rápida.

Asignación: Debo poder asignar el servicio a un analista cruzando su disponibilidad y su idoneidad para esa planta/cliente.

3. Control de Estados de la Gestión (Actualmente visual en Excel):
La aplicación debe manejar un flujo de estados claro para cada gestión:

Estado 1: Proyectado/Sin asignar (Gestiones identificadas para el mes).

Estado 2: Programado (El cliente dio el visto bueno por WhatsApp/llamada y el analista está notificado. En Excel era una "P").

Estado 3: Ejecutado (El analista realizó la medición en planta. En Excel era una "P" en negrilla).

Estado 4: Facturable/Cerrado (Informe entregado, orden de compra recogida, facturado. En Excel era resaltado en verde. Aquí se suma al cumplimiento del presupuesto mensual).

4. Nuevos Requerimientos (Funcionalidades Deseadas):

Hito de Cierre de Gestión: Un checklist o estado adicional donde el analista registra que ya realizó la reunión virtual de cierre con el cliente a través de nuestra plataforma Alertvox.

Módulo de Satisfacción (CSAT): Un formulario rápido (1 o 2 preguntas) enviado al cliente tras el cierre para calificar el servicio.

Evaluación de Desempeño: Los resultados de la encuesta de satisfacción del cliente deben interrelacionarse automáticamente con las métricas de desempeño del analista que ejecutó la gestión.

Con base en todo este contexto, por favor genera la propuesta técnica y el plan de acción para empezar a construir la aplicación.