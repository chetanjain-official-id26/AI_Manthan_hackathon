package com.expenseflow.policy;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AppConfigRepository extends JpaRepository<AppConfig, Long> {

    Optional<AppConfig> findFirstByConfigKeyAndActiveTrueOrderByVersionDesc(String key);
}
