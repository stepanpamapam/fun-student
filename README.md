# Fun Student

Учебный проект на Java 21 и Spring Boot. Веб-кабинет поддерживает просмотр студентов, управление карточками и управление учётными записями в зависимости от роли пользователя.

## Локальный запуск

1. Запустите PostgreSQL на порту 5432 и создайте базу `students_db`. По умолчанию проект подключается с именем пользователя `postgres`.
2. Задайте `DB_PASSWORD` для подключения к базе и `JWT_SECRET` для подписи токенов. Ключ можно сгенерировать командой `openssl rand -base64 32`.
3. Чтобы при первом запуске создать нужные учётные записи, задайте индивидуальные пароли через переменные окружения.

   | Переменная | Email | Роль |
   | --- | --- | --- |
   | `SUPER_ADMIN_PASSWORD` | superadmin@example.com | Управление учётными записями |
   | `ADMIN_PASSWORD` | admin@example.com | Управление студентами |
   | `TEACHER_PASSWORD` | teacher@example.com | Просмотр студентов |

4. Запустите `sh mvnw spring-boot:run` и откройте [кабинет](http://localhost:8080).

Исходный проект — [dorzhogun/fun-student](https://github.com/dorzhogun/fun-student).
