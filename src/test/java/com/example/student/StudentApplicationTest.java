package com.example.student;

import com.example.student.dto.AuthResponse;
import com.example.student.dto.LoginRequest;
import com.example.student.dto.StudentFullResponse;
import com.example.student.dto.StudentResponse;
import com.example.student.dto.StudentResponseList;
import com.example.student.dto.user.UserRequest;
import com.example.student.dto.user.UserResponse;
import com.example.student.dto.user.UserResponseList;
import com.example.student.model.Role;
import com.example.student.repository.UserRepository;
import com.example.student.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT;

@SpringBootTest(webEnvironment = RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:student_tests;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.datasource.hikari.schema=PUBLIC",
        "spring.datasource.hikari.connection-init-sql=SELECT 1",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "JWT_SECRET=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
})
class StudentApplicationTest {
    private static final String PASSWORD = "test-password";
    private static final String STUDENTS = "/api/v1/student";
    private static final String USERS = "/api/v1/users";

    @LocalServerPort
    private int port;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository userRepository;

    private final JsonMapper json = JsonMapper.builder().build();
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach
    void createAccounts() {
        userRepository.deleteAll();
        for (Role role : Role.values()) {
            assertThat(userService.register(new UserRequest(email(role), PASSWORD, Set.of(role)))).isTrue();
        }
    }

    @Test
    void administratorCanCreateReadUpdateAndDeleteStudent() throws Exception {
        String token = login(Role.ADMIN);
        var created = send("POST", STUDENTS + "/save", token, """
                {"name":"Anna","surname":"Petrova","phone_number":"111","email":"anna@example.test"}
                """);
        assertThat(created.statusCode()).isEqualTo(200);
        long id = json.readValue(created.body(), StudentResponse.class).getId();
        String path = STUDENTS + "/" + id;

        var list = send("GET", STUDENTS, token, null);
        assertThat(list.statusCode()).isEqualTo(200);
        assertThat(json.readValue(list.body(), StudentResponseList.class).getResponse())
                .anyMatch(student -> student.getId() == id && student.getName().equals("Anna"));
        var detail = send("GET", path, token, null);
        assertThat(detail.statusCode()).isEqualTo(200);
        assertThat(json.readValue(detail.body(), StudentFullResponse.class).getPhoneNumber()).isEqualTo("111");

        assertThat(send("PUT", path, token, """
                {"phoneNumber":"222"}
                """).statusCode()).isEqualTo(200);
        var updated = send("GET", STUDENTS + "/info/" + id, token, null);
        var student = json.readValue(updated.body(), StudentFullResponse.class);
        assertThat(student.getPhoneNumber()).isEqualTo("222");
        assertThat(student.getEmail()).isEqualTo("anna@example.test");

        assertThat(send("DELETE", path, token, null).statusCode()).isEqualTo(200);
        assertThat(send("GET", path, token, null).statusCode()).isEqualTo(404);
    }

    @Test
    void teacherCanReadStudentsAndCannotWriteOrManageUsers() throws Exception {
        String token = login(Role.TEACHER);
        assertThat(send("GET", STUDENTS, token, null).statusCode()).isEqualTo(200);
        assertThat(send("POST", STUDENTS + "/save", token, """
                {"name":"Anna","surname":"Petrova"}
                """).statusCode()).isEqualTo(403);
        assertThat(send("GET", USERS, token, null).statusCode()).isEqualTo(403);
    }

    @Test
    void superAdministratorCanManageUserAccounts() throws Exception {
        String token = login(Role.SUPER_ADMIN);
        String account = "new@example.test";
        var created = send("POST", USERS + "/save", token,
                json.writeValueAsString(new UserRequest(account, PASSWORD, Set.of(Role.TEACHER))));
        assertThat(created.statusCode()).isEqualTo(200);
        var user = json.readValue(created.body(), UserResponse.class);
        assertThat(user.getEmail()).isEqualTo(account);
        assertThat(user.getRoles()).containsExactly(Role.TEACHER);

        String path = USERS + "/" + user.getId();
        assertThat(send("PUT", path, token, json.writeValueAsString(
                new UserRequest(account, null, Set.of(Role.ADMIN)))).statusCode()).isEqualTo(200);
        var list = send("GET", USERS, token, null);
        assertThat(json.readValue(list.body(), UserResponseList.class).getResponses())
                .anyMatch(entry -> entry.getId() == user.getId() && entry.getRoles().equals(Set.of(Role.ADMIN)));
        assertThat(send("DELETE", path, token, null).statusCode()).isEqualTo(200);
        assertThat(userService.existsByEmail(account)).isFalse();
    }

    @Test
    void invalidCredentialsAndInvalidTokenAreRejected() throws Exception {
        var badLogin = send("POST", "/api/v1/auth/login", null,
                json.writeValueAsString(new LoginRequest(email(Role.ADMIN), "wrong-password")));
        assertThat(badLogin.statusCode()).isIn(401, 403);
        assertThat(send("GET", STUDENTS, "invalid-token", null).statusCode()).isEqualTo(401);
        assertThat(send("GET", STUDENTS, null, null).statusCode()).isIn(401, 403);
    }

    private String login(Role role) throws Exception {
        var response = send("POST", "/api/v1/auth/login", null,
                json.writeValueAsString(new LoginRequest(email(role), PASSWORD)));
        assertThat(response.statusCode()).isEqualTo(200);
        var auth = json.readValue(response.body(), AuthResponse.class);
        assertThat(auth.getRoles()).containsExactly("ROLE_" + role.name());
        return auth.getToken();
    }

    private String email(Role role) {
        return role.name().toLowerCase(java.util.Locale.ROOT) + "@example.test";
    }

    private HttpResponse<String> send(String method, String path, String token, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        if (body != null) {
            request.header("Content-Type", "application/json");
        }
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
